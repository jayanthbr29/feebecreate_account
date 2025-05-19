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
      host: 'smtp.hostinger.com',
      port: 465,
      secure: true,
      auth: {
        user: "Info@gully2global.com",
        pass: "Shasudigi@217",
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
      from: "Info@gully2global.com",
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
      host: 'smtp.hostinger.com',
      port: 465,
      secure: true,
      auth: {
        user: "Info@gully2global.com",
        pass: "Shasudigi@217",
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
      from: "Info@gully2global.com",
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
      host: 'smtp.hostinger.com',
      port: 465,
      secure: true,
      auth: {
        user: "Info@gully2global.com",
        pass: "Shasudigi@217",
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
      from: "Info@gully2global.com",
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
  const { toPhoneNumber, message, templateId } = req.body;
  if (!toPhoneNumber || !message) {
    return res.status(400).send({ error: 'Missing required fields' });
  }
  try {
    const response = await axios.get('http://sapteleservices.com/SMS_API/sendsms.php', {
      params: {
        username: 'feebe',
        password: '123456',
        mobile: toPhoneNumber,
        sendername: 'FEEBON',
        message: message,
        // template_id: templateId // This is the new part
      }
    });

    console.log('SMS sent:', response.data);
    res.status(200).send({ message: 'SMS sent successfully', response: response.data });
  } catch (error) {
    console.error('Failed to send SMS:', error.message);
    res.status(500).send({ error: 'Failed to send SMS', details: error.message });
  }

}
);