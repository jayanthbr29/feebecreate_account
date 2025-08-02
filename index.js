const express = require("express");
const admin = require("./firebaseConfig"); // Import initialized Firebase Admin SDK
const { sendScheduledNotifications } = require("./scheduleJob");
const { sendScheduledNotificationsSchoolClass } = require("./scheduleJobSchoolClass");
const { sendScheduledNotificationsSameDay } = require("./scheduleJobSameDay");
const { sendScheduledNotificationsSchoolClassSameDay } = require("./scheduleJobSchoolClassSameDay");
const { deleteOldNotifications } = require("./notificationRemoveJob");
const axios = require("axios");
const nodemailer = require('nodemailer');
const querystring = require('querystring');
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const multer = require('multer');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const path = require('path');
const upload = multer({ storage: multer.memoryStorage() });
const { generateToken, validateToken, markTokenUsed } = require("./forgotPasswordPageLinkService");
require("dotenv").config();
const app = express();
app.use(express.json());
const cors = require("cors");
app.use(cors());


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


    res.status(200).send({ message: "Notification sent successfullySameDay", SchoolSameDay: SchoolSameDay, SchoolClassSameDay: SchoolClassSameDay, notificationDelete: data });
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


    res.status(200).send({ message: "Notification sent successfully", School: School, SchoolClass: SchoolClass, notificationDelete: data });
  } catch (error) {
    console.error("Error sending notification:", error);
    res.status(500).send({ message: "Error sending notification", error: error.message });
  }

}
);

async function checkEmailExists(email) {
  try {
    const user = await admin.auth().getUserByEmail(email);
    return { exists: true, user };
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return { exists: false };
    }
    // throw error;
  }
}

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }
  
  const lowerCaseEmail = email.toLowerCase();
  const exists = await checkEmailExists(lowerCaseEmail);
  if (!exists?.exists) {
    return res.status(400).json({ success: false, message: 'Invalid email' });
  }
  const apiKey = process.env.FIREBASE_API_KEY || 'AIzaSyALJ5R9lmKbxp6r2lVpKUc9_z3sb1tBJVY';
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

  try {
    const { data } = await axios.post(url, {
      email: lowerCaseEmail,
      password,
      returnSecureToken: true,
    });

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      idToken: data.idToken,
      user: {
        email: data.email,
        localId: data.localId,
        displayName: data.displayName,
      },
    });
  } catch (error) {
    
    const firebaseError = error?.response?.data?.error;
    let message = 'Login failed';

    if (firebaseError) {
      switch (firebaseError.message) {
        case 'EMAIL_NOT_FOUND':
          message = 'Invalid email address';
          break;
        case 'INVALID_PASSWORD':
          message = 'Invalid credentials';
          break;
        case 'USER_DISABLED':
          message = 'Account disabled';
          break;
        case 'INVALID_EMAIL':
          message = 'Invalid email format';
          break;
        case 'TOO_MANY_ATTEMPTS_TRY_LATER':
          message = 'Too many attempts. Try again later';
          break;
        case'INVALID_LOGIN_CREDENTIALS':
          message = 'Invalid Password ';
          break;
        default:
          message = firebaseError.message || 'Invalid credentials';
      }
    } else {
      // Handle non-Firebase errors (network issues, etc.)
      message = error.message || 'Login failed';
    }

    return res.status(401).json({
      success: false,
      message
    });
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
app.post('/send-email', async (req, res) => {
  const { toEmail, userName, password,
    message = "Thank you for choosing Feebe for your preschool’s management. We understand how much care and attention goes into running a preschool, and we’re committed to providing a reliable, and efficient platform to support you."
  } = req.body;
  if (!toEmail || !userName || !password) {
    return res.status(400).send({ error: 'Missing required fields' });
  }

  try {
    // Configure transporter
    const transporter = nodemailer.createTransport({
      host: 'mail.feebe.in',
      port: 465,
      secure: true,
      auth: {
        user: "info@feebe.in",
        pass: "Qwertyuiop1!@#",
      },
    });

    // Email template
    const emailTemplate = `
  <!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Account Created</title>
    <style>
        /* Add fallback for email clients that don't support external styles */
        body {
            font-family: 'Nunito', sans-serif;
            background-color: #ffffff;
            margin: 0;
            padding: 0;
        }

        table {
            border-spacing: 0;
            width: 100%;
        }

        .container {
            max-width: 600px;
            margin: 20px auto;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }

        .header {
            background-color: #0052cc;
            text-align: center;
            padding: 20px;
        }

        .header-text {
            color: #000;
            background-color: #fff;
            font-size: 24px;
            display: inline-block;
            padding: 5px 10px;
            border-radius: 10px;
            font-size: 24px;
            align-items: center;
            align-content: center;
        }
        .header-text-content{
            display: flex;
        }
        /* .header-text {
            background-color: #fff;
            color: #000;
            padding: 5px 10px;
            border-radius: 10px;
            display: flex;
            font-size: 24px;
 
        } */


        .circle {
            width: 25px;
            height: 25px;
            border-radius: 50%;
            background-color: #0052cc;
            margin-left: 5px;
            display: inline-block;
        }
        
        /* .circle {
            width: 25px;
            height: 25px;
            border-radius: 50%;
            background-color: #0052cc;
            margin-left: 5px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #0052cc;
        } */


        .content {
            padding: 20px;
            text-align: center;
        }

        .box {
            border: 1px solid #0052cc;
            padding: 20px;
            border-radius: 15px;
            margin-top: 20px;
            width: 80%;
            margin: auto;
        }

        .credentials {
            display: block;
            margin-top: 10px;
        }

        .input-box {
            padding: 15px 40px;
            width: 60%;
            border-radius: 5px;
            text-align: left;
            font-size: 16px;
            border: 1px solid #0052cc;
            color: #333;
            margin: 10px auto;
        }

        .footer {
            text-align: center;
            padding: 20px;
            font-size: 14px;
            color: #666;
        }

        .app-links img {
            width: 100%;
        }

        .title {
            font-size: 20px;
            color: #000;
        }

        .sub-title {
            font-size: 16px;
            color: #000;
        }

        .thankyou {
            font-size: 16px;
            color: #001B36;
            text-align: left;
            line-height: 1.6;
        }

        .box-title {
            color: #000;
            margin: 10px 0 0 0;
        }

        .subcontent {
            color: #000;
            margin: 30px 0 0 0;
            font-size: 14px;
            text-align: left;
        }
    </style>
</head>

<body>
    <table role="presentation" class="container">
        <tr>
            <td class="header">
                <div class="header-text">
                    <div class="header-text-content">
                    FEEBE <div class="circle"></div>
                </div>
                </div>
            </td>
        </tr>
        <tr>
            <td class="content">
                <h2 class="title">Welcome to <span style="color: #0052cc;">Feebe</span></h2>
                <p class="sub-title">Fast, Easy, All-in-one <strong style="color: #0052cc;">Platform for Preschools</strong></p>
                <p class="thankyou">Hello ${userName},</p>
                <p class="thankyou">${message}</p>
                <div class="box">
                    <h2 class="box-title">Your Account is Successfully Created</h2>
                    <p class="box-subtitle">Your credentials are below</p>
                    <div class="credentials">
                        <div class="input-box">Email ID: ${toEmail}</div>
                        <div class="input-box">Password: ${password}</div>
                    </div>
                    <p class="subcontent">We recommend updating your password after your first login to ensure maximum security.</p>
                </div>
            </td>
        </tr>
        <tr>
            <td class="footer">
                <p class="subcontent">We’re excited to see how Feebe transforms your preschool management journey!</p>
               <div class="app-links" style="display: flex; justify-content: center; gap: 10px; margin-top: 15px;">
    <a href="https://play.google.com/store/apps/details?id=com.digi9.feebe" target="_blank">
        <img src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg" alt="Get it on Google Play" style="max-width: 140px;">
    </a>
    <a href="https://apps.apple.com/in/app/feebe/id6741058480" target="_blank">
        <img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" alt="Download on the App Store" style="max-width: 140px;">
    </a>
</div>


            </td>
        </tr>
    </table>
</body>

</html>
      `;

    // Mail options
    const mailOptions = {
      from: "info@feebe.in",
      to: toEmail,
      subject: "Welcome to Feebee, Your Account Has Been Created Successfully!",
      html: emailTemplate,
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);
    res.status(200).send({ message: 'Email sent', info });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).send({ error: 'Error sending email', details: error.message });
  }
});

app.post('/send-email/accountRemovedParent', async (req, res) => {
  const { name, Description, schoolName, toEmail

  } = req.body;
  if (!toEmail || !name || !Description || !schoolName) {
    return res.status(400).send({ error: 'Missing required fields' });
  }

  try {
    // Configure transporter
    const transporter = nodemailer.createTransport({
      host: 'mail.feebe.in',
      port: 465,
      secure: true,
      auth: {
        user: "info@feebe.in",
        pass: "Qwertyuiop1!@#",
      },
    });

    // Email template
    const emailTemplateParent = `
 <!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Account Created</title>
    <style>
        /* Add fallback for email clients that don't support external styles */
        body {
            font-family: 'Nunito', sans-serif;
            background-color: #f5f5f5;
            margin: 0;
            padding: 0;
        }

        table {
            border-spacing: 0;
            width: 100%;
        }

        .container {
            max-width: 600px;
            margin: 20px auto;
            background-color: #ffffff;
            border-radius: 10px;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }

        .header {
            background-color: #0052cc;
            text-align: center;
            padding: 20px;
        }

        .header-text {
            color: #000;
            background-color: #fff;
            font-size: 24px;
            display: inline-block;
            padding: 5px 10px;
            border-radius: 10px;
            font-size: 24px;
            align-items: center;
            align-content: center;
        }
        .header-text-content{
            display: flex;
        }
        /* .header-text {
            background-color: #fff;
            color: #000;
            padding: 5px 10px;
            border-radius: 10px;
            display: flex;
            font-size: 24px;
 
        } */


        .circle {
            width: 25px;
            height: 25px;
            border-radius: 50%;
            background-color: #0052cc;
            margin-left: 5px;
            display: inline-block;
        }
        
        /* .circle {
            width: 25px;
            height: 25px;
            border-radius: 50%;
            background-color: #0052cc;
            margin-left: 5px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #0052cc;
        } */


        .content {
            padding: 20px;
            text-align: center;
        }

        .box {
            border: 1px solid #0052cc;
            padding: 20px;
            border-radius: 15px;
            margin-top: 20px;
            width: 80%;
            margin: auto;
        }

        .credentials {
            display: block;
            margin-top: 10px;
        }

        .input-box {
            padding: 15px 40px;
            width: 60%;
            border-radius: 5px;
            text-align: left;
            font-size: 16px;
            border: 1px solid #0052cc;
            color: #333;
            margin: 10px auto;
        }

        .footer {
            text-align: center;
            padding: 20px;
            font-size: 14px;
              margin-bottom: 20px;
            color: #666;
        }

        .app-links img {
            width: 100%;
        }

        .title {
            font-size: 20px;
            color: #000;
        }

        .sub-title {
            font-size: 16px;
            color: #000;
        }

        .thankyou {
            font-size: 16px;
            color: #001B36;
            text-align: left;
            line-height: 1.6;
        }

        .box-title {
            color: #000;
            margin: 10px 0 0 0;
        }

        .subcontent {
            color: #000;
            margin: 30px 0 0 0;
            font-size: 14px;
            text-align: left;
            margin-bottom: 20px;
        }
    </style>
</head>

<body>
    <table role="presentation" class="container">
        <tr>
            <td class="header">
                <div class="header-text">
                    <div class="header-text-content">
                    FEEBE <div class="circle"></div>
                </div>
                </div>
            </td>
        </tr>
        <tr>
            <td class="content">
                <h2 class="title">Welcome to <span style="color: #0052cc;">Feebe</span></h2>
                <p class="sub-title">Fast, Easy, All-in-one <strong style="color: #0052cc;">Platform for Preschools</strong></p>
                <p class="thankyou">Hello ${name},</p>
                <p class="thankyou">${Description}</p>
                <div class="box">
                  Your account has been removed by <br />
                  <strong>${schoolName}</strong>
                </div>
            </td>
        </tr>
        <tr>
            <td class="footer">
                 <p class="subcontent">If this was done in error or if you have any questions regarding this deletion, please reach out to the school.<br>
        Thank you for being a part of our community.</p>
                <div class="app-links">
                    <a href="https://play.google.com/store/apps/details?id=com.digi9.feebe">
                        <img src="https://firebasestorage.googleapis.com/v0/b/feebee-8578d.firebasestorage.app/o/Frame%20289965%20(1).png?alt=media&token=72e2e7ee-f4c1-4764-9a5c-e537603a3a13" alt="App Store Link">
                    </a>
                </div>
            </td>
        </tr>
    </table>
</body>

</html>
      `;

    // Mail options
    const mailOptions = {
      from: "info@feebe.in",
      to: toEmail,
      subject: "Feebee, Your Account Has Been Removed!",
      html: emailTemplateParent,
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);

    res.status(200).send({ message: 'Email sent', info });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).send({ error: 'Error sending email', details: error.message });
  }
});

app.post('/send-email/accountRemovedStaff', async (req, res) => {
  const { name, Description, schoolName, toEmail

  } = req.body;
  if (!toEmail || !name || !Description || !schoolName) {
    return res.status(400).send({ error: 'Missing required fields' });
  }

  try {
    // Configure transporter
    const transporter = nodemailer.createTransport({
      host: 'mail.feebe.in',
      port: 465,
      secure: true,
      auth: {
        user: "info@feebe.in",
        pass: "Qwertyuiop1!@#",
      },
    });

    const emailTemplateStaff = `
    <!DOCTYPE html>
 <html lang="en">
 
 <head>
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>Account Created</title>
     <style>
         /* Add fallback for email clients that don't support external styles */
         body {
             font-family: 'Nunito', sans-serif;
             background-color: #f5f5f5;
             margin: 0;
             padding: 0;
         }
 
         table {
             border-spacing: 0;
             width: 100%;
         }
 
         .container {
             max-width: 600px;
             margin: 20px auto;
             background-color: #ffffff;
             border-radius: 10px;
             box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
             overflow: hidden;
         }
 
         .header {
             background-color: #0052cc;
             text-align: center;
             padding: 20px;
         }
 
         .header-text {
             color: #000;
             background-color: #fff;
             font-size: 24px;
             display: inline-block;
             padding: 5px 10px;
             border-radius: 10px;
             font-size: 24px;
             align-items: center;
             align-content: center;
         }
         .header-text-content{
             display: flex;
         }
         /* .header-text {
             background-color: #fff;
             color: #000;
             padding: 5px 10px;
             border-radius: 10px;
             display: flex;
             font-size: 24px;
  
         } */
 
 
         .circle {
             width: 25px;
             height: 25px;
             border-radius: 50%;
             background-color: #0052cc;
             margin-left: 5px;
             display: inline-block;
         }
         
         /* .circle {
             width: 25px;
             height: 25px;
             border-radius: 50%;
             background-color: #0052cc;
             margin-left: 5px;
             display: flex;
             align-items: center;
             justify-content: center;
             color: #0052cc;
         } */
 
 
         .content {
             padding: 20px;
             text-align: center;
         }
 
         .box {
             border: 1px solid #0052cc;
             padding: 20px;
             border-radius: 15px;
             margin-top: 20px;
             width: 80%;
             margin: auto;
         }
 
         .credentials {
             display: block;
             margin-top: 10px;
         }
 
         .input-box {
             padding: 15px 40px;
             width: 60%;
             border-radius: 5px;
             text-align: left;
             font-size: 16px;
             border: 1px solid #0052cc;
             color: #333;
             margin: 10px auto;
         }
 
         .footer {
             text-align: center;
             padding: 20px;
             font-size: 14px;
             margin-bottom: 20px;
             color: #666;
         }
 
         .app-links img {
             width: 100%;
         }
 
         .title {
             font-size: 20px;
             color: #000;
         }
 
         .sub-title {
             font-size: 16px;
             color: #000;
         }
 
         .thankyou {
             font-size: 16px;
             color: #001B36;
             text-align: left;
             line-height: 1.6;
         }
 
         .box-title {
             color: #000;
             margin: 10px 0 0 0;
         }
 
         .subcontent {
             color: #000;
             margin: 30px 0 0 0;
             font-size: 14px;
             text-align: left;
             margin-bottom: 20px;
         }
     </style>
 </head>
 
 <body>
     <table role="presentation" class="container">
         <tr>
             <td class="header">
                 <div class="header-text">
                     <div class="header-text-content">
                     FEEBE <div class="circle"></div>
                 </div>
                 </div>
             </td>
         </tr>
         <tr>
             <td class="content">
                 <h2 class="title">Welcome to <span style="color: #0052cc;">Feebe</span></h2>
                 <p class="sub-title">Fast, Easy, All-in-one <strong style="color: #0052cc;">Platform for Preschools</strong></p>
                 <p class="thankyou">Hello ${name},</p>
                 <p class="thankyou">${Description}</p>
                 <div class="box">
                   Your account has been removed by <br />
                   <strong>${schoolName}</strong>
                 </div>
             </td>
         </tr>
         <tr>
             <td class="footer">
                    <p class="subcontent">If you believe this was done in error or if you have any questions regarding this action, please reach out to the school.
       </p>
                 <div class="app-links">
                     <a href="https://play.google.com/store/apps/details?id=com.digi9.feebe">
                         <img src="https://firebasestorage.googleapis.com/v0/b/feebee-8578d.firebasestorage.app/o/Frame%20289965%20(1).png?alt=media&token=72e2e7ee-f4c1-4764-9a5c-e537603a3a13" alt="App Store Link">
                     </a>
                 </div>
             </td>
         </tr>
     </table>
 </body>
 
 </html>
          `;
    const mailOptions = {
      from: "info@feebe.in",
      to: toEmail,
      subject: "Feebee, Your Account Has Been Removed!",
      html: emailTemplateStaff,
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);

    res.status(200).send({ message: 'Email sent', info });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).send({ error: 'Error sending email', details: error.message });
  }
});

app.post('/send-sms', async (req, res) => {
  const { toPhoneNumber, templateId, userName, userPassword } = req.body;
  if (!toPhoneNumber) {
    return res.status(400).send({ error: 'Missing required fields' });
  }
  try {

    const username = "feebe";
    const password = "123456";
    const sendername = "FEEBON";
    const message = `Welcome!
Your preschool has added you to Feebe, the official app for sharing updates about your child.

Your account has been created successfully.
Download the Feebe app and use the login details below to access your account:

Username: ${userName}
Password: ${userPassword}

Download the Feebe app:
Android - https://play.google.com/store/apps/details?id=com.digi9.feebe
iOS - https://apps.apple.com/in/app/feebe/id6741058480?source=ioscta`;

    const encodedMessage = encodeURIComponent(message);

    const url = `http://sapteleservices.com/SMS_API/sendsms.php?username=${username}&password=${password}&mobile=${toPhoneNumber}&sendername=${sendername}&message=${encodedMessage}&routetype=1&tid=1207174739381775334`;

    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: url,
      headers: {}
    };

    axios.request(config)
      .then((response) => {
        console.log(JSON.stringify(response.data));
        res.status(200).send({ message: 'SMS sent successfully', response: response.data, MESSAGE: message });
      })
      .catch((error) => {
        console.log(error);
        res.status(500).send({ error: 'Failed to send SMS', details: error.message });
      });
  } catch (error) {
    console.error('Failed to send SMS:', error.message);
    res.status(500).send({ error: 'Failed to send SMS', details: error.message });
  }

}
);

app.post('/send-sms/admin-onboarding', async (req, res) => {
  const { toPhoneNumber, templateId, userName, userPassword } = req.body;
  if (!toPhoneNumber) {
    return res.status(400).send({ error: 'Missing required fields' });
  }
  try {

    const username = "feebe";
    const password = "123456";
    const sendername = "FEEBON";
    const message = `Welcome to Feebe!
You've been added as an admin by your preschool to Feebe- the official preschool app.

Your account has been created successfully.
Download the Feebe app and use the login details below to access your account:

Username: ${userName}
Password: ${userPassword}

Download the Feebe app:
Android - https://play.google.com/store/apps/details?id=com.digi9.feebe
iOS - https://apps.apple.com/in/app/feebe/id6741058480?source=ioscta`;

    const encodedMessage = encodeURIComponent(message);

    const url = `http://sapteleservices.com/SMS_API/sendsms.php?username=${username}&password=${password}&mobile=${toPhoneNumber}&sendername=${sendername}&message=${encodedMessage}&routetype=1&tid=1207174772134548266`;

    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: url,
      headers: {}
    };

    axios.request(config)
      .then((response) => {
        console.log(JSON.stringify(response.data));
        res.status(200).send({ message: 'SMS sent successfully', response: response.data, MESSAGE: message });
      })
      .catch((error) => {
        console.log(error);
        res.status(500).send({ error: 'Failed to send SMS', details: error.message });
      });
  } catch (error) {
    console.error('Failed to send SMS:', error.message);
    res.status(500).send({ error: 'Failed to send SMS', details: error.message });
  }

}
);

app.post('/send-sms/Preschool-onboarding-message', async (req, res) => {
  const { toPhoneNumber, templateId, userName, userPassword } = req.body;
  if (!toPhoneNumber) {
    return res.status(400).send({ error: 'Missing required fields' });
  }
  try {

    const username = "feebe";
    const password = "123456";
    const sendername = "FEEBON";
    const message = `Welcome to Feebe!
Thank you for choosing Feebe for your preschool's management.

Your account has been created successfully.
Download the Feebe app and use the login details below to access your account:

Username: ${userName}
Password: ${userPassword}

Download the Feebe app:
Android - https://play.google.com/store/apps/details?id=com.digi9.feebe
iOS - https://apps.apple.com/in/app/feebe/id6741058480?source=ioscta`;

    const encodedMessage = encodeURIComponent(message);

    const url = `http://sapteleservices.com/SMS_API/sendsms.php?username=${username}&password=${password}&mobile=${toPhoneNumber}&sendername=${sendername}&message=${encodedMessage}&routetype=1&tid=1207174774281596427`;

    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: url,
      headers: {}
    };

    axios.request(config)
      .then((response) => {
        console.log(JSON.stringify(response.data));
        res.status(200).send({ message: 'SMS sent successfully', response: response.data, MESSAGE: message });
      })
      .catch((error) => {
        console.log(error);
        res.status(500).send({ error: 'Failed to send SMS', details: error.message });
      });
  } catch (error) {
    console.error('Failed to send SMS:', error.message);
    res.status(500).send({ error: 'Failed to send SMS', details: error.message });
  }

}
);

app.post('/send-sms/removing-parent', async (req, res) => {
  const { toPhoneNumber, templateId, } = req.body;
  if (!toPhoneNumber) {
    return res.status(400).send({ error: 'Missing required fields' });
  }
  try {

    const username = "feebe";
    const password = "123456";
    const sendername = "FEEBOF";
    const message = `Dear parent,

You have been removed from Feebe by your preschool. If this is unexpected, please contact the school directly. We wish you all the best and hope your time with Feebe was helpful.`;

    const encodedMessage = encodeURIComponent(message);

    const url = `http://sapteleservices.com/SMS_API/sendsms.php?username=${username}&password=${password}&mobile=${toPhoneNumber}&sendername=${sendername}&message=${encodedMessage}&routetype=1&tid=1207174772073154159`;

    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: url,
      headers: {}
    };

    axios.request(config)
      .then((response) => {
        console.log(JSON.stringify(response.data));
        res.status(200).send({ message: 'SMS sent successfully', response: response.data, MESSAGE: message });
      })
      .catch((error) => {
        console.log(error);
        res.status(500).send({ error: 'Failed to send SMS', details: error.message });
      });
  } catch (error) {
    console.error('Failed to send SMS:', error.message);
    res.status(500).send({ error: 'Failed to send SMS', details: error.message });
  }

}
);

app.post('/send-sms/removing-preschool', async (req, res) => {
  const { toPhoneNumber, templateId, } = req.body;
  if (!toPhoneNumber) {
    return res.status(400).send({ error: 'Missing required fields' });
  }
  try {

    const username = "feebe";
    const password = "123456";
    const sendername = "FEEBOF";
    const message = `Dear Ma'am/Sir,
    
Your preschool has been removed from Feebe. If this was unexpected, please feel free to contact us. We wish you all the best and hope your time with Feebe was valuable.`;

    const encodedMessage = encodeURIComponent(message);

    const url = `http://sapteleservices.com/SMS_API/sendsms.php?username=${username}&password=${password}&mobile=${toPhoneNumber}&sendername=${sendername}&message=${encodedMessage}&routetype=1&tid=1207174772842835458`;

    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: url,
      headers: {}
    };

    axios.request(config)
      .then((response) => {
        console.log(JSON.stringify(response.data));
        res.status(200).send({ message: 'SMS sent successfully', response: response.data, MESSAGE: message });
      })
      .catch((error) => {
        console.log(error);
        res.status(500).send({ error: 'Failed to send SMS', details: error.message });
      });
  } catch (error) {
    console.error('Failed to send SMS:', error.message);
    res.status(500).send({ error: 'Failed to send SMS', details: error.message });
  }

}
);

app.post('/send-sms/removing-teacher', async (req, res) => {
  const { toPhoneNumber, templateId, } = req.body;
  if (!toPhoneNumber) {
    return res.status(400).send({ error: 'Missing required fields' });
  }
  try {

    const username = "feebe";
    const password = "123456";
    const sendername = "FEEBOF";
    const message = `Dear teacher,
    
You have been removed from Feebe by your preschool. If this is unexpected, please contact the school directly. We wish you all the best and hope your time with Feebe was helpful.`;

    const encodedMessage = encodeURIComponent(message);

    const url = `http://sapteleservices.com/SMS_API/sendsms.php?username=${username}&password=${password}&mobile=${toPhoneNumber}&sendername=${sendername}&message=${encodedMessage}&routetype=1&tid=1207174772345352143`;

    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: url,
      headers: {}
    };

    axios.request(config)
      .then((response) => {
        console.log(JSON.stringify(response.data));
        res.status(200).send({ message: 'SMS sent successfully', response: response.data, MESSAGE: message });
      })
      .catch((error) => {
        console.log(error);
        res.status(500).send({ error: 'Failed to send SMS', details: error.message });
      });
  } catch (error) {
    console.error('Failed to send SMS:', error.message);
    res.status(500).send({ error: 'Failed to send SMS', details: error.message });
  }

}
);

app.post('/send-sms/removing-admin', async (req, res) => {
  const { toPhoneNumber, templateId, } = req.body;
  if (!toPhoneNumber) {
    return res.status(400).send({ error: 'Missing required fields' });
  }
  try {

    const username = "feebe";
    const password = "123456";
    const sendername = "FEEBOF";
    const message = `Dear Admin,
    
You have been removed from Feebe by your preschool. If this is unexpected, please contact the school directly. We wish you all the best and hope your time with Feebe was helpful.`;

    const encodedMessage = encodeURIComponent(message);

    const url = `http://sapteleservices.com/SMS_API/sendsms.php?username=${username}&password=${password}&mobile=${toPhoneNumber}&sendername=${sendername}&message=${encodedMessage}&routetype=1&tid=1207174772208553519`;

    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: url,
      headers: {}
    };

    axios.request(config)
      .then((response) => {
        console.log(JSON.stringify(response.data));
        res.status(200).send({ message: 'SMS sent successfully', response: response.data, MESSAGE: message });
      })
      .catch((error) => {
        console.log(error);
        res.status(500).send({ error: 'Failed to send SMS', details: error.message });
      });
  } catch (error) {
    console.error('Failed to send SMS:', error.message);
    res.status(500).send({ error: 'Failed to send SMS', details: error.message });
  }

}
);

app.post('/send-sms/teacher-onboarding', async (req, res) => {
  const { toPhoneNumber, templateId, userName, userPassword } = req.body;
  if (!toPhoneNumber) {
    return res.status(400).send({ error: 'Missing required fields' });
  }
  try {

    const username = "feebe";
    const password = "123456";
    const sendername = "FEEBON";
    const message = `Welcome to Feebe!
    
You've been added as a teacher by your preschool to Feebe- the official preschool app.

Your account has been created successfully.
Download the Feebe app and use the login details below to access your account:

Username: ${userName}
Password: ${userPassword}

Download the Feebe app:
Android - https://play.google.com/store/apps/details?id=com.digi9.feebe
iOS - https://apps.apple.com/in/app/feebe/id6741058480?source=ioscta`;

    const encodedMessage = encodeURIComponent(message);

    const url = `http://sapteleservices.com/SMS_API/sendsms.php?username=${username}&password=${password}&mobile=${toPhoneNumber}&sendername=${sendername}&message=${encodedMessage}&routetype=1&tid=1207174772238552809`;

    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: url,
      headers: {}
    };

    axios.request(config)
      .then((response) => {
        console.log(JSON.stringify(response.data));
        res.status(200).send({ message: 'SMS sent successfully', response: response.data, MESSAGE: message });
      })
      .catch((error) => {
        console.log(error);
        res.status(500).send({ error: 'Failed to send SMS', details: error.message });
      });
  } catch (error) {
    console.error('Failed to send SMS:', error.message);
    res.status(500).send({ error: 'Failed to send SMS', details: error.message });
  }

}
);

app.post('/send-sms/forgot-password', async (req, res) => {
  const { userId, toPhoneNumber } = req.body;
  if (!userId) return res.status(400).json({ error: "Missing userId" });
  try {

    const token = await generateToken(userId);
    const link = `https://feebe.in/secure-link?token=${token}`;
    // return res.json({ link });
    const username = "feebe";
    const password = "123456";
    const sendername = "FEEADM";
    const message = `To reset your password for Feebe, click the link below. If you didn't request this, please ignore this message.
    ${link}
    Thank you`;

    const encodedMessage = encodeURIComponent(message);

    const url = `http://sapteleservices.com/SMS_API/sendsms.php?username=${username}&password=${password}&mobile=${toPhoneNumber}&sendername=${sendername}&message=${encodedMessage}&routetype=1&tid=1207174853062161362`;

    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: url,
      headers: {}
    };

    axios.request(config)
      .then((response) => {
        console.log(JSON.stringify(response.data));
        res.status(200).send({ message: 'SMS sent successfully', response: response.data, MESSAGE: message });
      })
      .catch((error) => {
        console.log(error);
        res.status(500).send({ error: 'Failed to send SMS', details: error.message });
      });
  } catch (error) {
    console.error('Failed to send SMS:', error.message);
    res.status(500).send({ error: 'Failed to send SMS', details: error.message });
  }
});

app.get('/validateSignature', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token is required" });

  try {
    const userId = await validateToken(token);
    return res.json({ success: true, userId });
  } catch (err) {
    return res.status(401).json({ success: false, error: err.message });
  }
});
app.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ success: false, message: "Missing token or newPassword" });
  }

  try {
    const userId = await validateToken(token);
    const uid = userId;
    await admin.auth().updateUser(uid, { password: newPassword });
    await markTokenUsed(token);
    res.status(200).json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("Password reset error:", error);
    res.status(500).json({ success: false, message: "Failed to reset password", error: error.message });
  }
});

app.post('/compress-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    const MAX_SIZE = 20 * 1024; // 20 KB
    const originalName = req.file.originalname;
    const ext = path.extname(originalName).toLowerCase();
    let buffer = req.file.buffer;
    let convertedFromHEIC = false;

    // 🔍 Detect and convert HEIC
    if (ext === '.heic' || ext === '.heif' || isHEICFile(buffer)) {
      try {
        buffer = await heicConvert({
          buffer,
          format: 'JPEG',
          quality: 1
        });
        convertedFromHEIC = true;
        console.log('✅ HEIC converted to JPEG');
      } catch (err) {
        console.error('❌ HEIC conversion failed:', err);
        return res.status(400).json({ message: 'Invalid HEIC image', error: err.message });
      }
    }

    // 🔁 Try compressing and resizing
    let quality = 80;
    let compressedBuffer;
    let success = false;

    for (; quality >= 10; quality -= 10) {
      try {
        compressedBuffer = await sharp(buffer)
          .resize({ width: 1024 }) // Resize for better compression
          .jpeg({ quality })       // Always convert to JPEG
          .toBuffer();

        if (compressedBuffer.length <= MAX_SIZE) {
          success = true;
          break;
        }
      } catch (err) {
        return res.status(500).json({ message: 'Sharp compression failed', error: err.message });
      }
    }

    if (!success) {
      return res.status(400).json({ message: 'Could not compress image under 20 KB' });
    }

    // ☁️ Upload to Firebase Storage
    const bucket = admin.storage().bucket();
    const timestamp = Date.now();
    const fileName = `compressed/${timestamp}_${originalName.replace(/\.[^/.]+$/, '')}.jpg`;
    const file = bucket.file(fileName);

    await file.save(compressedBuffer, {
      contentType: 'image/jpeg',
      metadata: { cacheControl: 'public, max-age=31536000' }
    });

    // 🔐 Generate signed URL (for UBLA buckets)
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000 // 1 hour
    });

    return res.status(200).json({
      message: 'Image compressed successfully',
      imageUrl: signedUrl,
      originalFormat: convertedFromHEIC ? 'heic' : ext.replace('.', ''),
      sizeKB: (compressedBuffer.length / 1024).toFixed(2),
      qualityUsed: quality
    });

  } catch (error) {
    console.error('Image compression error:', error);
    return res.status(500).json({ message: 'Error compressing image', error: error.message });
  }
});

// 🧠 HEIC detection by magic bytes (ftyp)
function isHEICFile(buffer) {
  return buffer.slice(8, 12).toString() === 'ftyp';
}

app.post('/compress-from-url', async (req, res) => {
  const { imageUrl } = req.body;
  if (!imageUrl) {
    return res.status(400).json({ message: 'imageUrl is required in request body' });
  }

  try {
    let buffer;
    const urlObj = new URL(imageUrl);
    const bucket = admin.storage().bucket();
    const isGCS  = urlObj.host === 'storage.googleapis.com';

    if (isGCS) {
      // ---- Direct download from GCS ----
      // decode & split pathname into segments ["feebee-8578d","compressed",...]
      const segments = decodeURIComponent(urlObj.pathname)
        .split('/')
        .filter(Boolean);
      // if first segment === bucket.name, drop it
      if (segments[0] === bucket.name) segments.shift();
      // re-join into the true object path
      const objectPath = segments.join('/');
      // download → Buffer
      [buffer] = await bucket.file(objectPath).download();
    } else {
      // ---- External URL via HTTP ----
      const resp = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10_000,
        maxContentLength: 50 * 1024 * 1024
      });
      buffer = Buffer.from(resp.data);
    }

    // ---- HEIC → JPEG conversion ----
    let convertedFromHEIC = false;
    const extGuess = path.extname(urlObj.pathname).toLowerCase();
    if (['.heic', '.heif'].includes(extGuess) || isHEICFile(buffer)) {
      buffer = await heicConvert({
        buffer,
        format: 'JPEG',
        quality: 1
      });
      convertedFromHEIC = true;
    }

    // ---- Compress via sharp ----
    const MAX_SIZE = 20 * 1024; // 20 KB
    let quality = 80, compressed;
    let success = false;
    for (; quality >= 10; quality -= 10) {
      compressed = await sharp(buffer)
        .resize({ width: 1024 })
        .rotate()               // auto-orient
        .jpeg({ quality })
        .toBuffer();
      if (compressed.length <= MAX_SIZE) {
        success = true;
        break;
      }
    }
    if (!success) {
      return res.status(400).json({ message: 'Could not compress image under 20 KB' });
    }

    // ---- Save compressed → GCS ----
    // build a clean filename from the original URL
    const decodedPath = decodeURIComponent(urlObj.pathname);
    const origExt     = path.extname(decodedPath) || '.jpg';
    const baseName    = path.basename(decodedPath, origExt);
    const fileName    = `compressed/${Date.now()}_${baseName}.jpg`;

    const file = bucket.file(fileName);
    await file.save(compressed, {
      contentType: 'image/jpeg',
      metadata: { cacheControl: 'public, max-age=31536000' }
    });

    // ---- Generate signed URL expiring Jan 1, 2050 ----
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: new Date('2050-01-01T00:00:00.000Z')
    });

    // ---- Respond ----
    return res.status(200).json({
      message: 'Image compressed successfully',
      imageUrl: signedUrl,
      originalFormat: convertedFromHEIC ? 'heic' : origExt.replace('.', ''),
      sizeKB: (compressed.length / 1024).toFixed(2),
      qualityUsed: quality
    });

  } catch (err) {
    console.error('URL compression error:', err);
    if (err.code === 'ETIMEDOUT') {
      return res.status(504).json({ message: 'Upstream request timed out' });
    }
    return res.status(500).json({
      message: 'Failed to process image URL',
      error: err.message
    });
  }
});


const bucket = admin.storage().bucket();

// ──────────────────────────────────────────────────────────────────────────────
// 2) Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Extracts a clean filePath from your expired signed URL:
 *   - strips query params
 *   - decodes twice to undo “%252F” → “/”
 */
function extractFilePath(signedUrl) {
  if (typeof signedUrl !== 'string') {
    throw new Error('signedUrl must be a string');
  }
  // 1) strip off ? and everything after
  const base = signedUrl.split('?')[0];
  // 2) capture everything after “/compressed/”
  const m = base.match(/\/compressed\/(.+)$/);
  if (!m) throw new Error('Invalid URL format – missing /compressed/');
  // 3) double-decode
  const once  = decodeURIComponent(m[1]);
  const twice = decodeURIComponent(once);
  return `compressed/${twice}`;
}

/**
 * Permanently makes a file public and returns its public URL.
 */
async function makePublicUrl(filePath) {
  const file = bucket.file(filePath);
  const [exists] = await file.exists();
  if (!exists) throw new Error(`No such file at path: ${filePath}`);
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
}

/**
 * Generates a fresh signed URL (default TTL: 1 hour).
 */
async function createSignedUrl(filePath, ttlSeconds = 3600) {
  const file = bucket.file(filePath);
  const [exists] = await file.exists();
  if (!exists) throw new Error(`No such file at path: ${filePath}`);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + ttlSeconds * 1000,
  });
  return url;
}

// ──────────────────────────────────────────────────────────────────────────────
// 3) Express App & Endpoint
// ──────────────────────────────────────────────────────────────────────────────





app.post('/refresh-signed-url', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ message: 'url is required in request body' });
  }

  try {
    // Parse the incoming signed URL
    const urlObj = new URL(url);
    const bucket = admin.storage().bucket();

    // Decode & split the pathname into segments
    const segments = decodeURIComponent(urlObj.pathname)
      .split('/')
      .filter(Boolean); // e.g. ["feebee-8578d","compressed",...]

    // If the first segment is the bucket name, remove it
    if (segments[0] === bucket.name) {
      segments.shift();
    }

    // Re-join to get the object path
    const objectPath = segments.join('/'); // e.g. "compressed/…/file.jpg"
    const file = bucket.file(objectPath);

    // Generate a new signed URL expiring Jan 1, 2050
    const [newSignedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: new Date('2050-01-01T00:00:00.000Z')
    });

    return res.status(200).json({ url: newSignedUrl });
  } catch (err) {
    console.error('Error refreshing signed URL:', err);
    return res.status(500).json({
      message: 'Failed to refresh signed URL',
      error: err.message
    });
  }
});
