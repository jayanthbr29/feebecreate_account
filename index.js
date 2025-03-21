const express = require("express");
const admin = require("./firebaseConfig"); // Import initialized Firebase Admin SDK
const { sendScheduledNotifications } = require("./scheduleJob");
const { sendScheduledNotificationsSchoolClass } = require("./scheduleJobSchoolClass");
const { sendScheduledNotificationsSameDay } = require("./scheduleJobSameDay");
const { sendScheduledNotificationsSchoolClassSameDay } = require("./scheduleJobSchoolClassSameDay");
const { deleteOldNotifications } = require("./notificationRemoveJob");
const axios = require("axios");

const app = express();
app.use(express.json());

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

app.post("/createUser", async (req, res) => {
  const {
    email,
    password,
    displayName,
    user_role,
    phone_number,
  } = req.body;

  // Check if required fields are present
  if (!email || !password || !displayName || !user_role || !phone_number) {
    return res.status(400).send({ message: "Missing required fields" });
  }

  try {
    // Check if a user with this email already exists
    const existingUser = await admin.auth().getUserByEmail(email).catch(() => null);
    if (existingUser) {
      return res.status(400).send({ message: "User already exists with this email" });
    }

    // Create a new user in Firebase Authentication
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: displayName,
    });

    // Set up a Firestore reference for the new user
    const userRef = db.collection("Users").doc(userRecord.uid);
    await userRef.set({
      email: userRecord.email,
      display_name: userRecord.displayName,
      user_role: user_role,
      phone_number: phone_number,
      created_time: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(), // Include updatedAt for later use
    });

    // Optional: Set custom user claims if needed for role-based access control
    // await admin.auth().setCustomUserClaims(userRecord.uid, { user_role: user_role });

    // Return success response with Firestore document reference and user data
    res.status(201).send({
      message: "User created successfully",
      userRef: userRef.path,
      userId: userRecord.uid, // Include user UID in response
      userData: {
        email: userRecord.email,
        display_name: userRecord.displayName,
        user_role: user_role,
        phone_number: phone_number,
      },
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).send({ message: "Error creating user", error: error.message });
  }
});
// DELETE /deleteUser/:uid endpoint to delete a user
app.delete("/deleteUser/:uid", async (req, res) => {
  const { uid } = req.params;

  if (!uid) {
    return res.status(400).send({ message: "Missing user UID" });
  }

  try {
    // Delete user from Firebase Authentication
    await admin.auth().deleteUser(uid);

    // Delete the user's Firestore document if it exists
    const userRef = db.collection("Users").doc(uid);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      await userRef.delete();
      console.log(`Firestore document for UID ${uid} deleted successfully.`);
    } else {
      console.log(`No Firestore document found for UID ${uid}.`);
    }

    // Return success response
    res.status(200).send({
      message: `User with UID ${uid} deleted successfully from Authentication and Firestore.`,
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).send({ message: "Error deleting user", error: error.message });
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});


app.get("/sendNotificationSameDay", async (req, res) => {

  try {
    
    const SchoolClassSameDay = await sendScheduledNotificationsSchoolClassSameDay();
    const SchoolSameDay = await sendScheduledNotificationsSameDay();
    const data = await deleteOldNotifications();


    res.status(200).send({ message: "Notification sent successfullySameDay",  SchoolSameDay: SchoolSameDay, SchoolClassSameDay: SchoolClassSameDay, notificationDelete: data });
  } catch (error) {
    console.error("Error sending notification:", error);
    res.status(500).send({ message: "Error sending notification", error: error.message });
  }
});

app.get("/sendnotification", async (req, res) => {
  try {
    const SchoolClass = await sendScheduledNotificationsSchoolClass();
   

    const School = await sendScheduledNotifications();
    const data = await deleteOldNotifications();


    res.status(200).send({ message: "Notification sent successfully", School: School, SchoolClass: SchoolClass,  notificationDelete: data });
  } catch (error) {
    console.error("Error sending notification:", error);
    res.status(500).send({ message: "Error sending notification", error: error.message });
  }

}
);

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).send('Email and password are required');
  }
  const lowerCaseEmail = email.toLowerCase();
  const Usersnapshot = await db.collection('Users').where('email', '==', lowerCaseEmail).get();
  if (Usersnapshot.empty) {
    res.status(200).send({ success: false, message: "Invalid Email" });

  } else {
    const apiKey = 'AIzaSyALJ5R9lmKbxp6r2lVpKUc9_z3sb1tBJVY'; //This is required to identify your project
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
    try {
      const { data } = await axios.post(url, {
        email,
        password,
        // returnSecureToken: true,
      });

      return res.status(200).json({ success: true, message: 'Login successful', idToken: data.idToken, user: data });
    } catch (e) {
      return res.status(200).json({ success: false, message: "Invalid Password" });
    }
  }
});

app.get("/search", async (req, res) => {
  try {
    // Retrieve 'school_name' from query params
    const { school_name, admin_name } = req.query;

    if (!school_name && !admin_name) {
      return res.status(400).send({ success: false, message: "School name or Admin name is required" });
    }
    if (school_name && admin_name) {
      return res.status(400).send({ success: false, message: "Please enter either School name or Admin name" });
    }
    if (school_name) {
      const schoolSnapshot = await db.collection("School")
        .where("school_details.school_name", "==", school_name)
        .get();

      if (schoolSnapshot.empty) {
        return res.status(200).send({ success: false, message: "No school found with that name" });
      } else {
        const schoolData = schoolSnapshot.docs.map(doc => doc.data());
        return res.status(200).send({ success: true, message: "School(s) found", data: schoolData });
      }
    }
    if (admin_name) {
      const schoolSnapshot = await db.collection("School")
        .where("principal_details.principal_name", "==", admin_name)
        .get();

      if (schoolSnapshot.empty) {
        return res.status(200).send({ success: false, message: "No school found with that principal" });
      } else {
        const schoolData = schoolSnapshot.docs.map(doc => doc.data());
        return res.status(200).send({ success: true, message: "School(s) found", data: schoolData });
      }
    }

  } catch (error) {
    console.error("Error fetching school data:", error);
    return res.status(500).send({ success: false, message: "An error occurred", error: error.message });
  }
});

