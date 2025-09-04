
const admin = require("./firebaseConfig"); // Import initialized Firebase Admin SDK
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;


exports.sendScheduledNotificationsSchoolClass = async () => {
    try {
        const now = admin.firestore.Timestamp.now();
        const today = now.toDate();

        // Calculate the target date (next day)
        const targetDate = new Date(today);
        targetDate.setDate(targetDate.getDate() ); // Set to midnight
        targetDate.setHours(0, 0, 0, 0);
        console.log("targetDate 11 ", targetDate);
        const startOfDay = admin.firestore.Timestamp.fromDate(targetDate);
        // const endOfDay = admin.firestore.Timestamp.fromDate(new Date(targetDate.getTime() + 24 * 60 * 60 * 1000));
        const endOfDay = new Date(targetDate);
        endOfDay.setDate(endOfDay.getDate());
        endOfDay.setHours(23, 59, 59, 999);
        // Convert seconds to a JavaScript Date object

        // Query all documents in the 'notices' collection
        const noticesSnapshot = await db.collection('School_class').get();

        let allNotifications = [];
        let allNotifications2 = [];
      
        // console.log("noticesSnapshot", noticesSnapshot);

        // Iterate through each document
        for (const doc of noticesSnapshot.docs) {
            const data = doc.data();
            const docRef = doc.ref;
            let listOfAdmins = [];

            try {
                const schoolSnapshot = await db.collection('School')
                    .where('List_of_class', 'array-contains', docRef)  // docRef must be a DocumentReference
                    .get();


                // Check if we got any matching school document
                if (!schoolSnapshot.empty) {
                    schoolSnapshot.forEach(schoolDoc => {
                        const schoolData = schoolDoc.data();
                        const ListOfAdmins = schoolData.listOfAdmin || [];  // Assuming listOfAdmin holds references to admin users
                        listOfAdmins = listOfAdmins.concat(ListOfAdmins);
                        // console.log('Matched School:', schoolData);
                        // console.log('List of Admins:', ListOfAdmins);

                    });
                } else {
                    console.log('No matching school found for the given class reference');
                }
            } catch (error) {
                console.error('Error fetching school document:', error);
            }

            // console.log("data", data);
            const notices = data.calendar || [];
            // allNotifications.push(data);

            // console.log("notices", notices);
            const teachers = data.listOfteachersUser || [];

            let parents = [];
            data.student_data?.forEach((item) => {
                parents = parents.concat(item.parent_list);
            })



            // Filter notices occurring on the target date
            const todaysNotices = notices.filter(notice => {
                const noticeDate = notice?.Event_date.toDate();
                return noticeDate >= targetDate && noticeDate < endOfDay;
            });

            if (todaysNotices.length === 0) continue; // No notices for tomorrow in this document

            // Fetch FCM tokens
            const teacherTokens = await getFCMTokens(teachers);
            const parentTokens = await getFCMTokens(parents);
            const adminTokens = await getFCMTokens(listOfAdmins);

            // console.log("teacherTokens", teacherTokens);
            // console.log("parentTokens", parentTokens);

            const combinedTokens = [...teacherTokens, ...parentTokens,...adminTokens];

            if (combinedTokens.length === 0) continue; // No tokens to send to

            // Create notification payloads for each notice
            todaysNotices.forEach(notice => {
                const payload = {
                    notification: {
                        title: notice.Event_Title || 'Notification',
                        body: `${notice.Event_Title} has been scheduled for tomorrow.
                         ${notice.Event_description || ''}`,
                        // clickAction: 'FLUTTER_NOTIFICATION_CLICK', // Adjust based on your app
                    },
                };

                allNotifications.push({
                    tokens: combinedTokens,
                    payload,
                });
            });

            // allNotifications.push({// test ata sent
            //     notices,
            //     teacherTokens,
            //     parentTokens,
            // })
        }
        // Send notifications in batches
        const response = await sendNotificationsInBatches(allNotifications);

        // console.log('Notifications sent successfully:', response, allNotifications2);
        return response;
    } catch (error) {
        console.error('Error sending scheduled notifications:', error);
    }
};



/**
 * Helper function to send notifications in batches
 * @param {Array<Object>} notifications 
 * @returns {Promise<Array<Object>>}
 */
const sendNotificationsInBatches = async (notifications) => {
    const allResponses = [];

    for (const notification of notifications) {
        const { tokens, payload } = notification;

        // Firebase allows sending up to 500 tokens in one batch
        const batches = chunkArray(tokens, 500);

        if (batches.length === 0) continue;
        for (const batchTokens of batches) {
            const response = await admin.messaging().sendEachForMulticast({
                tokens: batchTokens,
                ...payload,
            });

            allResponses.push(response);
        }
    }

    return allResponses;
};



/**
 * Helper function to split an array into chunks
 * @param {Array} array 
 * @param {number} size 
 * @returns {Array<Array>}
 */
const chunkArray = (array, size) => {
    const results = [];
    for (let i = 0; i < array.length; i += size) {
        results.push(array.slice(i, i + size));
    }
    return results;
};

/**
 * Retrieves FCM tokens from the 'fcm_tokens' sub-collection of each user.
 * @param {Array<admin.firestore.DocumentReference>} refs - Array of user DocumentReferences.
 * @returns {Promise<Array<string>>} - Array of FCM tokens.
 */
const getFCMTokens = async (refs) => {
    if (!refs || refs.length === 0) return [];
    const tokens = [];

    try {
        // Fetch all users in parallel
        const userPromises = refs?.map(ref => ref?.get());
        const userDocs = await Promise.all(userPromises);

        // For each user document, fetch the 'fcm_tokens' sub-collection
        const tokenPromises = userDocs.map(async (userDoc) => {
            if (userDoc?.exists) {
                const fcmTokensSnapshot = await userDoc.ref.collection('fcm_tokens').get();
                fcmTokensSnapshot.forEach(tokenDoc => {
                    const tokenData = tokenDoc.data();
                    // console.log("tokenData", tokenData);
                    if (tokenData?.fcm_token) { // Assuming the token field is named 'token'
                        tokens.push(tokenData.fcm_token);
                    }
                });
            }
        });

        await Promise.all(tokenPromises);
    } catch (error) {
        console.error('Error retrieving FCM tokens:', error);
    }

    return tokens;
};
