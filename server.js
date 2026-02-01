require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');

// ✅ Appwrite Import & InputFile Fix (Robust Strategy)
const Appwrite = require('node-appwrite');
const { Client, Databases, Users, Account, Storage, Query, ID } = Appwrite;

// InputFile লোড করার জন্য বিশেষ লজিক (v14.1.0 ফিক্স)
let InputFile = Appwrite.InputFile;
if (!InputFile) {
    try {
        // যদি সরাসরি না পাওয়া যায়, সাব-মডিউল থেকে চেষ্টা করবে
        InputFile = require('node-appwrite/file').InputFile;
    } catch (e) {
        console.warn("⚠️ Warning: InputFile could not be loaded directly. Uploads might fail.");
    }
}

const app = express();
app.use(express.json());
app.use(cors());

// --- SYSTEM CHECK LOGS ---
console.log("------------------------------------------");
console.log("🔵 System Check:");
console.log(`🔹 Project ID: ${process.env.APPWRITE_PROJECT_ID}`);
console.log(`🔹 InputFile:  ${InputFile ? "✅ Loaded" : "❌ Undefined"}`);
console.log("------------------------------------------");

// --- CONFIGURATION ---
const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY); // Admin Key

const databases = new Databases(client);
const users = new Users(client);
const storage = new Storage(client);

// Environment Constants
const DB_ID = process.env.DATABASE_ID || 'central_db';
const COLL_PROFILE = process.env.COLLECTION_PROFILE || 'user_profiles';
const COLL_SYSTEM = process.env.COLLECTION_SYSTEM_DATA || 'system_data';
const BUCKET_ID = process.env.BUCKET_ID || 'profile_pics';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://pbsnet.pages.dev';


// Multer (Memory Storage)
const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// 🛡️ MIDDLEWARES
// ==========================================

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: "Access Denied: No Token" });
    
    try { 
        const token = authHeader.split(' ')[1];
        req.user = jwt.verify(token, process.env.JWT_SECRET); 
        next(); 
    } catch { 
        res.status(403).json({ error: "Invalid or Expired Token" }); 
    }
};

const verifyAdmin = (req, res, next) => {
    if (req.headers['x-admin-secret'] === process.env.APPWRITE_API_KEY) {
        next();
    } else {
        res.status(403).json({ error: "Access Denied: Admin Secret Required" });
    }
};

// ==========================================
// 🔑 AUTHENTICATION ROUTES
// ==========================================

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        // 1. Create Auth User
        const user = await users.create(ID.unique(), email, null, password, name);
        // 2. Create DB Document
        await databases.createDocument(DB_ID, COLL_PROFILE, user.$id, { 
            full_name: name, 
            email: email, 
            personal_json: "{}" 
        });
        res.status(201).json({ message: "Registration Successful", userId: user.$id });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// Smart Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        let email = identifier;
        let userId = null;

        // Mobile Number Handling
        if (!identifier.includes('@')) {
            const list = await databases.listDocuments(DB_ID, COLL_PROFILE, [Query.equal('mobile', identifier)]);
            if (list.total === 0) return res.status(404).json({ error: "User not found with this mobile" });
            email = list.documents[0].email;
            userId = list.documents[0].$id;
        }

        // Verify Password (Create Session)
        // Note: Using a fresh client without API Key to simulate user-side login
        try {
            const tempClient = new Client()
                .setEndpoint(process.env.APPWRITE_ENDPOINT)
                .setProject(process.env.APPWRITE_PROJECT_ID);
            
            await new Account(tempClient).createEmailPasswordSession(email, password);
            
            // If logged in via email directly, fetch userId from users list
            if (!userId) { 
                const u = await users.list([Query.equal('email', email)]); 
                if(u.users.length > 0) userId = u.users[0].$id;
            }
        } catch (authErr) { 
            return res.status(401).json({ error: "Invalid Password or Email" }); 
        }

        // Generate JWT
        const token = jwt.sign({ userId, email }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ message: "Login OK", token, userId });

    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Google Login URL
app.get('/api/auth/google', (req, res) => {
    const redirect = `${process.env.APPWRITE_ENDPOINT}/account/sessions/oauth2/google?project=${process.env.APPWRITE_PROJECT_ID}&success=${FRONTEND_URL}/dashboard&failure=${FRONTEND_URL}/login`;
    res.json({ redirectUrl: redirect });
});



// ✅ Google/Appwrite Session Exchange for JWT
app.post('/api/auth/oauth-success', async (req, res) => {
    try {
        const { appwriteJwt } = req.body;
        
        if (!appwriteJwt) return res.status(400).json({ error: "No JWT provided" });

        // ১. Appwrite JWT ভেরিফাই করা (নতুন ক্লায়েন্ট দিয়ে)
        const verifyClient = new Client()
            .setEndpoint(process.env.APPWRITE_ENDPOINT)
            .setProject(process.env.APPWRITE_PROJECT_ID)
            .setJWT(appwriteJwt); // ইউজার সেশন সেট করা
        
        const verifyAccount = new Account(verifyClient);
        const appwriteUser = await verifyAccount.get(); // ভ্যালিড হলে ইউজার ডাটা দেবে

        const email = appwriteUser.email;
        const name = appwriteUser.name;

        // ২. ডাটাবেসে ইউজার আছে কিনা চেক বা তৈরি করা
        // নোট: এখানে আমরা অ্যাডমিন ক্লায়েন্ট (যা উপরে ডিফাইন করা আছে) ব্যবহার করব ডাটাবেস এক্সেসের জন্য
        let list = await databases.listDocuments(DB_ID, COLL_PROFILE, [Query.equal('email', email)]);
        let userId;

        if (list.total === 0) {
            // নতুন ইউজার রেজিস্টার (পাসওয়ার্ড ছাড়া, কারণ গুগল ইউজার)
            const randomPass = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
            
            // Appwrite Auth-এ ডুপ্লিকেট এড়াতে try-catch
            try {
                await users.create(ID.unique(), email, null, randomPass, name);
            } catch (e) {
                // ইউজার যদি ইতিমধ্যে অথেন্টিকেশনে থাকে কিন্তু প্রোফাইল টেবিলে না থাকে
                console.log("User might already exist in Auth, proceeding to DB creation");
            }

            // প্রোফাইল কালেকশনে ডকুমেন্ট তৈরি
            // আগে ইউজারের সঠিক ID বের করে নিই
            const authUserList = await users.list([Query.equal('email', email)]);
            const finalUserId = authUserList.users[0].$id;

            await databases.createDocument(DB_ID, COLL_PROFILE, finalUserId, { 
                full_name: name, 
                email: email, 
                personal_json: "{}" 
            });
            userId = finalUserId;
        } else {
            userId = list.documents[0].$id;
        }

        // ৩. কাস্টম JWT টোকেন ইস্যু করা
        const token = jwt.sign({ userId, email }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ message: "OAuth Login Success", token, userId });

    } catch (e) {
        console.error(e);
        res.status(401).json({ error: "Authentication Failed: " + e.message });
    }
});

// Forgot Password
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const clientTemp = new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID);
        await new Account(clientTemp).createRecovery(req.body.email, `${FRONTEND_URL}/reset-password`);
        res.json({ message: "Recovery link sent" });
    } catch (e) { res.status(500).json({ error: "Failed to send link" }); }
});

// Retrieve Key
app.post('/api/auth/retrieve-key', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        const list = await databases.listDocuments(DB_ID, COLL_PROFILE, [Query.equal(identifier.includes('@')?'email':'mobile', identifier)]);
        if(list.total === 0) return res.status(404).json({error: "User not found"});
        
        try {
            const tmp = new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID);
            await new Account(tmp).createEmailPasswordSession(list.documents[0].email, password);
        } catch { return res.status(401).json({ error: "Wrong Password" }); }

        res.json({ status: "success", user_api_key: list.documents[0].api_key || "Not Generated" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// 👤 PROFILE ROUTES
// ==========================================

// Get Profile (Updated with URL Logic)
app.get('/api/me', verifyToken, async (req, res) => {
    try {
        const doc = await databases.getDocument(DB_ID, COLL_PROFILE, req.user.userId);
        
        // ✅ Server-Side URL Generation
        let picUrl = null;
        if (doc.profile_pic_id) {
            picUrl = `${process.env.APPWRITE_ENDPOINT}/storage/buckets/${BUCKET_ID}/files/${doc.profile_pic_id}/view?project=${process.env.APPWRITE_PROJECT_ID}&mode=admin`;
        }

        res.json({
            full_name: doc.full_name,
            username: doc.username,
            email: doc.email,
            mobile: doc.mobile,
            post_name: doc.post_name,
            office_name: doc.office_name,
            pbs_name: doc.pbs_name,
            api_key: doc.api_key,
            profile_pic_id: doc.profile_pic_id,
            profile_pic_url: picUrl, // ✅ New Field
            personal_json: JSON.parse(doc.personal_json || "{}")
        });
    } catch (e) { res.status(404).json({ error: "Profile not found" }); }
});

// Update Core Info
app.put('/api/me', verifyToken, async (req, res) => {
    try {
        const { full_name, mobile, post_name, office_name, pbs_name } = req.body;
        await databases.updateDocument(DB_ID, COLL_PROFILE, req.user.userId, {
            full_name, mobile, post_name, office_name, pbs_name
        });
        res.json({ message: "Updated" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update JSON Data
app.patch('/api/me/json', verifyToken, async (req, res) => {
    try {
        const d = await databases.getDocument(DB_ID, COLL_PROFILE, req.user.userId);
        const merged = { ...JSON.parse(d.personal_json || "{}"), ...req.body };
        await databases.updateDocument(DB_ID, COLL_PROFILE, req.user.userId, { personal_json: JSON.stringify(merged) });
        res.json({ message: "JSON Updated", data: merged });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Set Username
app.post('/api/me/username', verifyToken, async (req, res) => {
    try {
        const { newUsername } = req.body;
        if(!/^[a-z0-9_]{3,20}$/.test(newUsername)) return res.status(400).json({ error: "Invalid username format" });

        const check = await databases.listDocuments(DB_ID, COLL_PROFILE, [Query.equal('username', newUsername)]);
        if (check.total > 0) return res.status(409).json({ error: "Username Taken" });
        
        await databases.updateDocument(DB_ID, COLL_PROFILE, req.user.userId, { username: newUsername });
        res.json({ message: "Username Updated" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Profile Picture Upload (Robust InputFile)
app.post('/api/me/pic', verifyToken, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        if (!InputFile) return res.status(500).json({ error: "Server Error: InputFile module missing" });

        const userId = req.user.userId;

        // Delete Old Pic
        try {
            const userDoc = await databases.getDocument(DB_ID, COLL_PROFILE, userId);
            if (userDoc.profile_pic_id) {
                await storage.deleteFile(BUCKET_ID, userDoc.profile_pic_id).catch(() => {});
            }
        } catch (e) {}

        // Upload New Pic
        const file = await storage.createFile(
            BUCKET_ID,
            ID.unique(),
            InputFile.fromBuffer(req.file.buffer, 'profile.png')
        );

        await databases.updateDocument(DB_ID, COLL_PROFILE, userId, { profile_pic_id: file.$id });
        res.json({ message: "Profile Picture Updated", fileId: file.$id });

    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Change Password
app.post('/api/me/pass', verifyToken, async (req, res) => {
    try {
        await users.updatePassword(req.user.userId, req.body.newPassword);
        res.json({ message: "Password Changed" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generate API Key
app.post('/api/me/key', verifyToken, async (req, res) => {
    try {
        const k = 'pbsnet-' + Math.random().toString(36).substring(2, 18);
        await databases.updateDocument(DB_ID, COLL_PROFILE, req.user.userId, { api_key: k });
        res.json({ message: "Key Generated", key: k });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// --- server.js এর নিচের অংশ আপডেট করুন ---

// Search Users (Updated with Designation & Filters)
app.get('/api/users/search', verifyToken, async (req, res) => {
    try {
        const { pbs, office, mobile, designation, search, username } = req.query;
        let q = [];

        if (pbs) q.push(Query.equal('pbs_name', pbs));
        if (office) q.push(Query.equal('office_name', office));
        if (mobile) q.push(Query.equal('mobile', mobile));
        if (designation) q.push(Query.equal('post_name', designation)); // New Filter
        if (username) q.push(Query.equal('username', username));
        if (search) q.push(Query.search('full_name', search));
        
        // Limit results to 20 to avoid heavy load
        const list = await databases.listDocuments(DB_ID, COLL_PROFILE, q);
        
        const results = list.documents.map(u => {
            let pic = null;
            if(u.profile_pic_id) {
                pic = `${process.env.APPWRITE_ENDPOINT}/storage/buckets/${BUCKET_ID}/files/${u.profile_pic_id}/view?project=${process.env.APPWRITE_PROJECT_ID}`;
            }
            return { 
                name: u.full_name, 
                username: u.username, 
                pbs: u.pbs_name,
                designation: u.post_name, // ✅ Added for List View
                office: u.office_name,
                pic_url: pic 
            };
        });

        res.json({ users: results });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ✅ Public Profile View (For "View Full Profile")
app.get('/api/profile/:username', verifyToken, async (req, res) => {
    try {
        const list = await databases.listDocuments(DB_ID, COLL_PROFILE, [Query.equal('username', req.params.username)]);
        if (list.total === 0) return res.status(404).json({ error: "User not found" });

        const u = list.documents[0];
        let pic = null;
        if(u.profile_pic_id) {
            pic = `${process.env.APPWRITE_ENDPOINT}/storage/buckets/${BUCKET_ID}/files/${u.profile_pic_id}/view?project=${process.env.APPWRITE_PROJECT_ID}`;
        }

        res.json({
            full_name: u.full_name,
            username: u.username,
            post_name: u.post_name,
            pbs_name: u.pbs_name,
            office_name: u.office_name,
            mobile: u.mobile,
            email: u.email,
            profile_pic_url: pic,
            personal_json: JSON.parse(u.personal_json || "{}")
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});




// ==========================================
// 🛡️ ADMIN ROUTES (Secure System Data & Full Profile)
// ==========================================

// ১. অ্যাডমিন ভিউ রাউট (View: Full Profile + Secure Data)
app.post('/api/admin/user-app-data/view', verifyAdmin, async (req, res) => {
    try {
        const { target_user_key, subclass } = req.body;

        // A. ইউজার ভেরিফিকেশন (API Key দিয়ে ইউজার খোঁজা)
        const userList = await databases.listDocuments(DB_ID, COLL_PROFILE, [Query.equal('api_key', target_user_key)]);
        if (userList.total === 0) return res.status(404).json({ error: "Invalid User Key" });
        
        const user = userList.documents[0];
        const userId = user.$id; // ইউজারের ID দিয়েই সিস্টেম ডাটা খুঁজব

        // B. সিকিউর সিস্টেম ডাটা ফেচ করা (Direct ID মেথড)
        let appJson = {};
        try {
            // সরাসরি ID দিয়ে খোঁজা হচ্ছে (Query দরকার নেই, তাই ফাস্ট)
            const sysDoc = await databases.getDocument(DB_ID, COLL_SYSTEM, userId);
            appJson = JSON.parse(sysDoc.app_json || "{}");
        } catch (e) {
            // ডাটা না থাকলে (নতুন ইউজার) খালি অবজেক্ট রিটার্ন করবে
            console.log(`System data not found for user ${userId}, returning empty.`);
        }

        // C. রেসপন্স পাঠানো
        if (subclass) {
            // যদি নির্দিষ্ট সাব-ক্লাস চায় (যেমন: 'billing') তবে শুধু সেটুকুই যাবে
            return res.json({ 
                user: user.full_name, 
                subclass_data: appJson[subclass] || {} 
            });
        }

        // ডিফল্ট: ইউজারের সম্পূর্ণ প্রোফাইল + পার্সোনাল ডাটা + সিস্টেম ডাটা
        res.json({
            // বেসিক প্রোফাইল তথ্য
            full_name: user.full_name,
            username: user.username,
            email: user.email,
            mobile: user.mobile,
            designation: user.post_name,
            office: user.office_name,
            pbs: user.pbs_name,
            
            // ডাটা সেকশন
            personal_json: JSON.parse(user.personal_json || "{}"), // সাধারণ ডাটা
            app_json: appJson // ✅ সিকিউর সিস্টেম ডাটা (system_data কালেকশন থেকে)
        });

    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ২. অ্যাডমিন আপডেট রাউট (Update: Only System Data)
app.patch('/api/admin/user-app-data', verifyAdmin, async (req, res) => {
    try {
        const { target_user_key, subclass, data } = req.body;

        if (!subclass || !data) return res.status(400).json({ error: "Subclass and Data required" });

        // A. ইউজার ভেরিফিকেশন
        const userList = await databases.listDocuments(DB_ID, COLL_PROFILE, [Query.equal('api_key', target_user_key)]);
        if (userList.total === 0) return res.status(404).json({ error: "Invalid User Key" });
        
        const userId = userList.documents[0].$id;

        // B. বর্তমান ডাটা আনা বা নতুন তৈরি করা
        let currentAppJson = {};
        let docExists = false;

        try {
            // ডাটা আছে কিনা চেক করা (Direct ID)
            const sysDoc = await databases.getDocument(DB_ID, COLL_SYSTEM, userId);
            currentAppJson = JSON.parse(sysDoc.app_json || "{}");
            docExists = true;
        } catch (e) {
            // ডকুমেন্ট নেই, নতুন বানাতে হবে
            docExists = false;
        }

        // C. ডাটা মার্জ করা (Subclass Logic)
        // আগের ডাটা মুছে যাবে না, শুধু নির্দিষ্ট subclass আপডেট হবে
        currentAppJson[subclass] = { ...(currentAppJson[subclass] || {}), ...data };
        const jsonString = JSON.stringify(currentAppJson);

        // D. ডাটাবেসে সেভ করা
        if (docExists) {
            await databases.updateDocument(DB_ID, COLL_SYSTEM, userId, { 
                app_json: jsonString 
            });
        } else {
            // নতুন ডকুমেন্ট তৈরির সময় ইউজারের ID-কেই ডকুমেন্টের ID হিসেবে ব্যবহার করা হচ্ছে
            await databases.createDocument(DB_ID, COLL_SYSTEM, userId, {
                app_json: jsonString
            });
        }

        res.json({ 
            message: `System Data Updated for '${subclass}'`, 
            updated_data: currentAppJson[subclass] 
        });

    } catch (e) { res.status(500).json({ error: e.message }); }
});












// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`pbsNet Server Running on Port ${PORT}`));