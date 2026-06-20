const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const mongoose = require('mongoose');

const LOCAL_DB_URL = "mongodb://127.0.0.1:27017/CommuteDB";
const CLOUD_DB_URL = "mongodb+srv://Aniket001:Wi5iVScdg3uvGBno@cluster0.j3031go.mongodb.net/CommuteDB?retryWrites=true&w=majority&appName=Cluster0&tlsAllowInvalidCertificates=true";

mongoose.connect(CLOUD_DB_URL, { serverSelectionTimeoutMS: 4000 })
    .then(() => console.log("🍃 Successfully connected to the Cloud MongoDB Database!"))
    .catch(() => {
        console.warn("⚠️ Cloud port blocked. Falling back to local configuration...");
        mongoose.connect(LOCAL_DB_URL).catch(() => {
            console.log("ℹ️ Running in Sandbox Memory Mode. System data isolated locally.");
        });
    });

const userSchema = new mongoose.Schema({
    contact: { type: String, required: true },
    password: { type: String, required: true },
    username: { type: String, default: "" },
    bio: { type: String, default: "" },
    traits: [String],      
    interests: [String],   
    dislikes: [String],    
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Memory RAM array for perfect database replication locally
let sandboxUsers = [];

app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Signup
app.post('/api/auth/signup', async (request, response) => {
    try {
        const { contact, password } = request.body;
        if (!contact || !password) return response.status(400).json({ error: "All fields are required!" });

        let userId;
        if (mongoose.connection.readyState === 1) {
            const existingUser = await User.findOne({ contact });
            if (existingUser) return response.status(400).json({ error: "Account already exists!" });
            const newUser = new User({ contact, password });
            await newUser.save();
            userId = newUser._id;
        } else {
            userId = "sb_" + Math.random().toString(36).substr(2, 9);
            const newSandboxUser = { _id: userId, contact, password, username: "", bio: "", traits: [], interests: [], dislikes: [] };
            sandboxUsers.push(newSandboxUser);
        }
        response.status(201).json({ message: "Success", userId });
    } catch (err) { response.status(500).json({ error: "Server Error" }); }
});

// Login
app.post('/api/auth/login', async (request, response) => {
    try {
        const { contact, password } = request.body;
        if (mongoose.connection.readyState === 1) {
            const user = await User.findOne({ contact, password });
            if (!user) return response.status(400).json({ error: "Invalid credentials!" });
            return response.json({ userId: user._id, hasProfile: !!user.username });
        }
        const sbUser = sandboxUsers.find(u => u.contact === contact && u.password === password);
        if (!sbUser) return response.status(400).json({ error: "User not found in sandbox memory!" });
        response.json({ userId: sbUser._id, hasProfile: !!sbUser.username });
    } catch (err) { response.status(500).json({ error: "Server Error" }); }
});

// Save Profile
app.post('/api/profile/save', async (request, response) => {
    try {
        const { userId, username, bio, traits, interests, dislikes } = request.body;
        if (mongoose.connection.readyState === 1) {
            await User.findByIdAndUpdate(userId, { username, bio, traits, interests, dislikes });
        } else {
            let sbUser = sandboxUsers.find(u => u._id === userId);
            if (sbUser) {
                sbUser.username = username;
                sbUser.bio = bio;
                sbUser.traits = traits || [];
                sbUser.interests = interests || [];
                sbUser.dislikes = dislikes || [];
            }
        }
        response.json({ message: "Saved!" });
    } catch (err) { response.status(500).json({ error: "Error saving profile" }); }
});

// Discovery Engine (CRITICAL FIX HERE)
app.get('/api/discover/:userId', async (request, response) => {
    try {
        const currentUserId = request.params.userId;
        let currentUser = null;
        let allOtherUsers = [];

        if (mongoose.connection.readyState === 1) {
            currentUser = await User.findById(currentUserId);
            allOtherUsers = await User.find({ _id: { $ne: currentUserId } });
        } else {
            currentUser = sandboxUsers.find(u => u._id === currentUserId);
            // 🔥 FIXED EXCLUSION: Strict string matching to completely block yourself from showing up
            allOtherUsers = sandboxUsers.filter(u => u._id.toString() !== currentUserId.toString());
        }

        if (!currentUser) currentUser = { traits: [], interests: [], dislikes: [] };

        let matchFeed = allOtherUsers.map(user => {
            let score = 50; // default baseline match %
            if (currentUser.traits) {
                user.traits.forEach(t => { if (currentUser.traits.includes(t)) score += 10; });
                user.interests.forEach(i => { if (currentUser.interests.includes(i)) score += 5; });
                user.dislikes.forEach(d => { if (currentUser.dislikes.includes(d)) score += 2; });
            }
            if (score > 100) score = 100;

            return {
                id: user._id,
                username: user.username || "Anonymous Soul",
                bio: user.bio || "No bio added yet.",
                matchScore: score
            };
        });

        matchFeed.sort((a, b) => b.matchScore - a.matchScore);
        response.json(matchFeed);
    } catch (err) { response.status(500).json({ error: "Matching error" }); }
});

// --- REAL-TIME CHAT CORNERSTONE ---
io.on('connection', (socket) => {
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`👥 Active WebSocket connection inside Room: ${roomId}`);
    });

    socket.on('send_message', (data) => {
        console.log(`📩 Routing: [${data.sender}] -> Room [${data.room}]: ${data.message}`);
        // Broadcasts explicitly to the specific targeted room channel matching across both browsers
        io.to(data.room).emit('receive_message', data);
    });

    socket.on('typing_signal', (data) => {
        socket.to(data.room).emit('typing_receive', data);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 System working beautifully at http://localhost:${PORT}`);
});