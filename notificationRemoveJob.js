const admin = require("./firebaseConfig"); // Import initialized Firebase Admin SDK
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

exports.deleteOldNotifications = async () => {
    try {
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth()-1 ); // Subtract 1 month
        console.log("oneMonthAgo", oneMonthAgo);
        console.log(`Deleting notifications before: ${oneMonthAgo}`);

        const notificationsRef = await db.collection("Notifications");
        console.log("notificationsRef", notificationsRef);
        const snapshot = await notificationsRef
            .where("createDate", "<", oneMonthAgo)
            .get();

        if (snapshot.empty) {
            console.log("No old notifications found.");
            return null;
        }
       

        const batch = db.batch();

        snapshot.forEach((doc) => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        console.log(`Deleted ${snapshot.size} old notifications.`);
        return snapshot;
    } catch (error) {
        console.error("Error deleting old notifications:", error);
    }
};