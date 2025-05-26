const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const admin = require("./firebaseConfig"); // Import initialized Firebase Admin SDK
const db = admin.firestore();

// 5 minutes


exports.generateToken = async (userId) => {
    const SECRET = process.env.JWT_SECRET;
    const COLLECTION = "oneTimeTokens";
    const EXPIRATION_SECONDS = 5 * 60;
    const jti = uuidv4();
    const expiresAt = new Date(Date.now() + EXPIRATION_SECONDS * 1000);
    const payload = { userId, jti };

    const token = jwt.sign(payload, SECRET, { expiresIn: EXPIRATION_SECONDS });
    await db.collection(COLLECTION).doc(jti).set({
        userId,
        token,
        used: false,
        createdAt: new Date(),
        expiresAt,
    });

    return token;
};

exports.validateToken = async (token) => {
    try {
        const SECRET = process.env.JWT_SECRET;
        const COLLECTION = "oneTimeTokens";
        const EXPIRATION_SECONDS = 5 * 60;
        const decoded = jwt.verify(token, SECRET);
        const tokenDoc = await db.collection(COLLECTION).doc(decoded.jti).get();

        if (!tokenDoc.exists || tokenDoc.data().used) {
            throw new Error("Token is invalid or already used");
        }

        await tokenDoc.ref.update({ used: false });
        return decoded.userId;
    } catch (err) {
        throw new Error("Invalid or expired token");
    }
};

exports.markTokenUsed = async (token) => {
    const SECRET = process.env.JWT_SECRET;
    const COLLECTION = "oneTimeTokens";
    const EXPIRATION_SECONDS = 5 * 60;
    const decoded = jwt.verify(token, SECRET);
    const { jti } = decoded;
    const tokenRef = db.collection(COLLECTION).doc(jti);
    const tokenDoc = await tokenRef.get();

    if (!tokenDoc.exists) {
        throw new Error("Token not found");
    }

    const data = tokenDoc.data();

    if (data.used) {
        throw new Error("Token already used");
    }

    await tokenRef.update({ used: true, usedAt: new Date() });
};


// const cleanOldTokens = async () => {
//   const cutoff = new Date();
//   cutoff.setMonth(cutoff.getMonth() - 1);

//   const snapshot = await db.collection("oneTimeTokens")
//     .where("createdAt", "<", cutoff)
//     .get();

//   const batch = db.batch();
//   snapshot.forEach((doc) => batch.delete(doc.ref));
//   await batch.commit();

//   console.log(`Cleaned ${snapshot.size} old tokens`);
// };