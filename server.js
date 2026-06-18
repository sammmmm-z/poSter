const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// ⚠️ 在这里替换成你的 Cloudinary 信息 ⚠️
// ============================================================
cloudinary.config({
    cloud_name: 'dypdxasrx',     // ← 替换成你的
    api_key: '728437311635572',           // ← 替换成你的
    api_secret: 'tTFmv6W02It5AkOX2vV2MiOYYQY'      // ← 替换成你的
});

// ============================================================
// ⚠️ 在这里替换成你的 MongoDB 连接字符串 ⚠️
// ============================================================
const MONGODB_URI = 'mongodb+srv://samzhang1207_db_user:lkZQF5JQPjSVXYwX@cluster0.sxzer6l.mongodb.net/?appName=Cluster0';
const DB_NAME = 'posterDB';

let db;
let usersCollection;
let feedsCollection;
let messagesCollection;

// ============================================================
// 连接 MongoDB
// ============================================================
async function connectToMongoDB() {
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('✅ Connected to MongoDB Atlas!');
        db = client.db(DB_NAME);
        usersCollection = db.collection('users');
        feedsCollection = db.collection('feeds');
        messagesCollection = db.collection('messages');
        
        await usersCollection.createIndex({ username: 1 }, { unique: true });
        await usersCollection.createIndex({ 'profile.handle': 1 }, { unique: true });
        await feedsCollection.createIndex({ id: 1 }, { unique: true });
        await messagesCollection.createIndex({ id: 1 }, { unique: true });
        
        console.log('✅ Database collections ready!');
        return true;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        return false;
    }
}

// ============================================================
// Multer 配置（用内存存储，不上传硬盘）
// ============================================================
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB 限制
});

// ============================================================
// 中间件
// ============================================================
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// ============================================================
// Helper 函数
// ============================================================
const hashPassword = (password) => {
    return crypto.createHash('sha256').update(password).digest('hex');
};

// ========== 从 MongoDB 加载数据 ==========
const loadUsers = async () => {
    try {
        const users = await usersCollection.find({}).toArray();
        return users.map(user => ({
            ...user,
            profile: {
                name: user.profile?.name || user.username,
                handle: user.profile?.handle || user.username,
                bio: user.profile?.bio || 'Hello, I am new to poSter!',
                hobbies: user.profile?.hobbies || [],
                birthday: user.profile?.birthday || 'Unknown',
                followingList: user.profile?.followingList || [],
                avatar: user.profile?.avatar || ''
            }
        }));
    } catch (error) {
        console.error('Error loading users:', error);
        return [];
    }
};

const saveUsers = async (users) => {
    try {
        await usersCollection.deleteMany({});
        if (users.length > 0) {
            await usersCollection.insertMany(users);
        }
    } catch (error) {
        console.error('Error saving users:', error);
    }
};

const loadFeed = async () => {
    try {
        const feed = await feedsCollection.find({}).toArray();
        return feed.map(post => ({
            ...post,
            likedBy: post.likedBy || [],
            media: post.media || [],
            comments: post.comments || []
        }));
    } catch (error) {
        console.error('Error loading feed:', error);
        return [];
    }
};

const saveFeed = async (feed) => {
    try {
        await feedsCollection.deleteMany({});
        if (feed.length > 0) {
            await feedsCollection.insertMany(feed);
        }
    } catch (error) {
        console.error('Error saving feed:', error);
    }
};

const loadMessages = async () => {
    try {
        return await messagesCollection.find({}).toArray();
    } catch (error) {
        console.error('Error loading messages:', error);
        return [];
    }
};

const saveMessages = async (messages) => {
    try {
        await messagesCollection.deleteMany({});
        if (messages.length > 0) {
            await messagesCollection.insertMany(messages);
        }
    } catch (error) {
        console.error('Error saving messages:', error);
    }
};

const generateGroupId = () => {
    return 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
};

const calculateFollowersCount = (targetUsername, allUsers) => {
    const targetUser = allUsers.find(u => u.username === targetUsername);
    if (!targetUser || !targetUser.profile) return 0;
    const targetHandle = targetUser.profile.handle;
    let count = 0;
    for (const user of allUsers) {
        if (user.username !== targetUsername) {
            if (user.profile && Array.isArray(user.profile.followingList) && user.profile.followingList.includes(targetHandle)) {
                count++;
            }
        }
    }
    return count;
};

// ============================================================
// 上传到 Cloudinary 的辅助函数
// ============================================================
const uploadToCloudinary = (fileBuffer, folder = 'poster') => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: folder,
                resource_type: 'auto'
            },
            (error, result) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            }
        );
        uploadStream.end(fileBuffer);
    });
};

// ============================================================
// API 端点
// ============================================================

// ========== Register ==========
app.post('/api/register', async (req, res) => {
    const { username, password, name, handle } = req.body;
    if (!username || !password || !name || !handle) {
        return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    const users = await loadUsers();
    if (users.find(user => user.username === username)) {
        return res.status(409).json({ success: false, message: 'Username already exists.' });
    }
    if (users.find(user => user.profile && user.profile.handle === handle)) {
        return res.status(409).json({ success: false, message: 'Handle already taken.' });
    }
    const hashedPassword = hashPassword(password);
    const newUser = {
        username,
        password: hashedPassword,
        profile: {
            name,
            handle,
            bio: 'None',
            hobbies: ['None'],
            birthday: 'None',
            followingList: [],
            avatar: ''
        }
    };
    users.push(newUser);
    await saveUsers(users);
    res.json({ success: true, message: 'Registration successful!' });
});

// ========== Login ==========
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }
    const hashedPassword = hashPassword(password);
    const users = await loadUsers();
    const user = users.find(u => u.username === username && u.password === hashedPassword);
    if (user) {
        res.json({ success: true, message: 'Login successful!' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }
});

// ========== Create Post ==========
app.post('/api/post/create', upload.array('media', 10), async (req, res) => {
    const { username, content } = req.body;
    if (!username || !content) {
        return res.status(400).json({ success: false, message: 'Username and content are required.' });
    }
    const users = await loadUsers();
    const user = users.find(u => u.username === username);
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // 上传媒体文件到 Cloudinary
    const mediaFiles = req.files || [];
    const media = [];
    for (const file of mediaFiles) {
        try {
            const result = await uploadToCloudinary(file.buffer, 'poster_media');
            const ext = path.extname(file.originalname).toLowerCase();
            const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
            const isVideo = ['.mp4', '.mov', '.avi', '.webm'].includes(ext);
            media.push({
                url: result.secure_url,
                type: isImage ? 'image' : (isVideo ? 'video' : 'unknown'),
                filename: result.public_id
            });
        } catch (error) {
            console.error('Error uploading to Cloudinary:', error);
        }
    }

    const feed = await loadFeed();
    const newPost = {
        id: Date.now(),
        author: username,
        content: content,
        media: media,
        likes: 0,
        likedBy: [],
        comments: [],
        createdAt: new Date().toISOString()
    };
    feed.push(newPost);
    await saveFeed(feed);

    const authorUser = users.find(u => u.username === username);
    const postResponse = {
        ...newPost,
        author_username: authorUser ? authorUser.profile.name : username,
        author_handle: authorUser ? authorUser.profile.handle : username,
        author_avatar: authorUser ? authorUser.profile.avatar : '',
        user_liked: false
    };
    res.json({ success: true, message: 'Post created successfully!', post: postResponse });
});

// ========== Update Post ==========
app.put('/api/post/update', async (req, res) => {
    const { postId, username, content } = req.body;
    if (!postId || !username || !content) {
        return res.status(400).json({ success: false, message: 'Post ID, username and content are required.' });
    }
    try {
        let feed = await loadFeed();
        const postIndex = feed.findIndex(post => post.id === postId);
        if (postIndex === -1) {
            return res.status(404).json({ success: false, message: 'Post not found.' });
        }
        const post = feed[postIndex];
        if (post.author !== username) {
            return res.status(403).json({ success: false, message: 'You are not authorized to edit this post.' });
        }
        post.content = content;
        post.updatedAt = new Date().toISOString();
        await saveFeed(feed);
        const users = await loadUsers();
        const authorUser = users.find(u => u.username === username);
        const postResponse = {
            ...post,
            author_username: authorUser ? authorUser.profile.name : username,
            author_handle: authorUser ? authorUser.profile.handle : username,
            author_avatar: authorUser ? authorUser.profile.avatar : '',
            user_liked: post.likedBy ? post.likedBy.includes(username) : false
        };
        res.json({ success: true, message: 'Post updated successfully.', post: postResponse });
    } catch (error) {
        console.error('Error updating post:', error);
        res.status(500).json({ success: false, message: 'Server error during post update.' });
    }
});

// ========== Delete Post ==========
app.delete('/api/post/delete', async (req, res) => {
    const { postId, username } = req.body;
    if (!postId || !username) {
        return res.status(400).json({ success: false, message: 'Post ID and username are required.' });
    }
    try {
        let feed = await loadFeed();
        const postIndex = feed.findIndex(post => post.id === postId);
        if (postIndex === -1) {
            return res.status(404).json({ success: false, message: 'Post not found.' });
        }
        const post = feed[postIndex];
        if (post.author !== username) {
            return res.status(403).json({ success: false, message: 'You are not authorized to delete this post.' });
        }
        // 从 Cloudinary 删除媒体文件
        if (post.media && post.media.length > 0) {
            for (const mediaItem of post.media) {
                if (mediaItem.filename) {
                    try {
                        await cloudinary.uploader.destroy(mediaItem.filename);
                    } catch (err) {
                        console.warn(`Failed to delete from Cloudinary: ${err.message}`);
                    }
                }
            }
        }
        feed.splice(postIndex, 1);
        await saveFeed(feed);
        res.json({ success: true, message: 'Post deleted successfully.' });
    } catch (error) {
        console.error('Error deleting post:', error);
        res.status(500).json({ success: false, message: 'Server error during post deletion.' });
    }
});

// ========== Get Feed ==========
app.get('/api/feed', async (req, res) => {
    const sort = req.query.sort || 'recent';
    const username = req.query.username;
    let feed = await loadFeed();
    const users = await loadUsers();
    const feedWithDetails = feed.map(post => {
        const authorUser = users.find(u => u.username === post.author);
        const commentsWithAvatar = (post.comments || []).map(comment => {
            const commentUser = users.find(u => u.username === comment.username);
            return {
                ...comment,
                user_avatar: commentUser ? commentUser.profile.avatar : '',
                user_name: commentUser ? commentUser.profile.name : comment.username
            };
        });
        return {
            ...post,
            comments: commentsWithAvatar,
            author_username: authorUser ? authorUser.profile.name : post.author,
            author_handle: authorUser ? authorUser.profile.handle : post.author,
            author_avatar: authorUser ? authorUser.profile.avatar : '',
            user_liked: username ? (post.likedBy || []).includes(username) : false
        };
    });
    let sortedFeed = [...feedWithDetails];
    if (sort === 'recent') {
        sortedFeed.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (sort === 'recommended') {
        sortedFeed.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    }
    res.json({ success: true, posts: sortedFeed });
});

// ========== Like/Unlike ==========
app.post('/api/feed/:postId/react', async (req, res) => {
    const postId = parseInt(req.params.postId, 10);
    const { username, action } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required.' });
    }
    const feed = await loadFeed();
    const index = feed.findIndex(post => post.id === postId);
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Post not found.' });
    }
    const post = feed[index];
    if (!Array.isArray(post.likedBy)) {
        post.likedBy = [];
    }
    const userIndex = post.likedBy.indexOf(username);
    const currentlyLiked = userIndex !== -1;
    if (action === 'like') {
        if (!currentlyLiked) {
            post.likedBy.push(username);
            post.likes = (post.likes || 0) + 1;
        }
    } else if (action === 'unlike') {
        if (currentlyLiked) {
            post.likedBy.splice(userIndex, 1);
            post.likes = (post.likes || 0) - 1;
        }
    } else {
        return res.status(400).json({ success: false, message: 'Invalid action.' });
    }
    await saveFeed(feed);
    const users = await loadUsers();
    const authorUser = users.find(u => u.username === post.author);
    const postResponse = {
        ...post,
        author_username: authorUser ? authorUser.profile.name : post.author,
        author_handle: authorUser ? authorUser.profile.handle : post.author,
        author_avatar: authorUser ? authorUser.profile.avatar : '',
        user_liked: post.likedBy.includes(username)
    };
    res.json({ success: true, message: action === 'like' ? 'Post liked.' : 'Post unliked.', post: postResponse });
});

// ========== Comment ==========
app.post('/api/feed/:postId/comment', async (req, res) => {
    const { username, text } = req.body;
    const postId = parseInt(req.params.postId, 10);
    if (!username || !text) {
        return res.status(400).json({ success: false, message: 'Username and comment text are required.' });
    }
    const feed = await loadFeed();
    const index = feed.findIndex(post => post.id === postId);
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Post not found.' });
    }
    const users = await loadUsers();
    const commentUser = users.find(u => u.username === username);
    const newComment = {
        id: Date.now(),
        username: username,
        text: text,
        user_avatar: commentUser ? commentUser.profile.avatar : '',
        user_name: commentUser ? commentUser.profile.name : username,
        createdAt: new Date().toISOString()
    };
    if (!Array.isArray(feed[index].comments)) {
        feed[index].comments = [];
    }
    feed[index].comments.push(newComment);
    await saveFeed(feed);
    const updatedPost = feed[index];
    const authorUser = users.find(u => u.username === updatedPost.author);
    const postResponse = {
        ...updatedPost,
        author_username: authorUser ? authorUser.profile.name : updatedPost.author,
        author_handle: authorUser ? authorUser.profile.handle : updatedPost.author,
        author_avatar: authorUser ? authorUser.profile.avatar : '',
        user_liked: updatedPost.likedBy ? updatedPost.likedBy.includes(username) : false
    };
    res.json({ success: true, post: postResponse, comment: newComment });
});

// ========== Suggested Users ==========
app.get('/api/users/suggested', async (req, res) => {
    const currentUser = req.query.username;
    if (!currentUser) {
        return res.status(400).json({ success: false, message: 'Username is required.' });
    }
    const users = await loadUsers();
    const currentProfile = users.find(u => u.username === currentUser)?.profile;
    if (!currentProfile) {
        return res.status(404).json({ success: false, message: 'Current user profile not found.' });
    }
    const followingHandles = new Set(currentProfile.followingList);
    const suggested = users
        .filter(user => user.username !== currentUser)
        .filter(user => user.profile && !followingHandles.has(user.profile.handle))
        .map(user => ({
            name: user.profile.name,
            handle: user.profile.handle,
            username: user.username,
            avatar: user.profile.avatar
        }))
        .slice(0, 5);
    res.json({ success: true, users: suggested });
});

// ========== Get Profile ==========
app.get('/api/profile/get', async (req, res) => {
    const username = req.query.username;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required.' });
    }
    const users = await loadUsers();
    const user = users.find(u => u.username === username);
    if (!user || !user.profile) {
        return res.status(404).json({ success: false, message: 'User profile not found.' });
    }
    const followersCount = calculateFollowersCount(username, users);
    const profileResponse = { ...user.profile, followersCount: followersCount };
    res.json({ success: true, profile: profileResponse });
});

// ========== Update Profile ==========
app.post('/api/profile/update', upload.single('avatar'), async (req, res) => {
    const { username, name, bio, birthday, hobbies } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required for update.' });
    }
    const users = await loadUsers();
    const userIndex = users.findIndex(u => u.username === username);
    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const userProfile = users[userIndex].profile;
    if (name) userProfile.name = name;
    if (bio) userProfile.bio = bio;
    if (birthday) userProfile.birthday = birthday;
    if (hobbies) {
        userProfile.hobbies = Array.isArray(hobbies) ? hobbies : hobbies.split(',').map(h => h.trim()).filter(h => h);
    }

    let newAvatar = userProfile.avatar;
    if (req.file) {
        try {
            const result = await uploadToCloudinary(req.file.buffer, 'poster_avatars');
            newAvatar = result.secure_url;
            userProfile.avatar = newAvatar;
        } catch (error) {
            console.error('Error uploading avatar to Cloudinary:', error);
            return res.status(500).json({ success: false, message: 'Error uploading avatar.' });
        }
    }

    try {
        await saveUsers(users);
        res.json({ success: true, message: 'Profile updated successfully!', profile: userProfile });
    } catch (error) {
        console.error('Error saving users after profile update:', error);
        res.status(500).json({ success: false, message: 'Server error during save operation.' });
    }
});

// ========== List Followers/Following ==========
app.get('/api/profile/list', async (req, res) => {
    const { type, username } = req.query;
    if (!username || !['followers', 'following'].includes(type)) {
        return res.status(400).json({ success: false, message: 'Username and a valid list type (followers/following) are required.' });
    }
    const users = await loadUsers();
    const targetUser = users.find(u => u.username === username);
    if (!targetUser || !targetUser.profile) {
        return res.status(404).json({ success: false, message: 'Target user profile not found.' });
    }
    let userList = [];
    if (type === 'following') {
        const followingHandles = targetUser.profile.followingList || [];
        userList = users
            .filter(u => followingHandles.includes(u.profile.handle))
            .map(u => ({
                name: u.profile.name,
                handle: u.profile.handle,
                username: u.username,
                avatar: u.profile.avatar,
                bio: u.profile.bio
            }));
    } else if (type === 'followers') {
        const targetHandle = targetUser.profile.handle;
        userList = users
            .filter(u => u.username !== username)
            .filter(u => u.profile && Array.isArray(u.profile.followingList) && u.profile.followingList.includes(targetHandle))
            .map(u => ({
                name: u.profile.name,
                handle: u.profile.handle,
                username: u.username,
                avatar: u.profile.avatar,
                bio: u.profile.bio
            }));
    }
    res.json({ success: true, users: userList });
});

// ========== Follow/Unfollow ==========
const toggleFollow = async (req, res, action) => {
    const { username, follow_handle, unfollow_handle } = req.body;
    const targetHandle = action === 'follow' ? follow_handle : unfollow_handle;
    if (!username || !targetHandle) {
        return res.status(400).json({ success: false, message: 'Username and target handle are required.' });
    }
    const users = await loadUsers();
    const currentUserIndex = users.findIndex(u => u.username === username);
    const targetUser = users.find(u => u.profile && u.profile.handle === targetHandle);
    if (currentUserIndex === -1 || !targetUser) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const currentProfile = users[currentUserIndex].profile;
    if (!currentProfile.followingList) currentProfile.followingList = [];
    const isFollowing = currentProfile.followingList.includes(targetHandle);
    if (action === 'follow') {
        if (isFollowing) {
            return res.json({ success: true, message: 'Already following.' });
        }
        currentProfile.followingList.push(targetHandle);
        await saveUsers(users);
        res.json({ success: true, message: `Successfully followed ${targetHandle}.` });
    } else if (action === 'unfollow') {
        if (!isFollowing) {
            return res.json({ success: true, message: 'Not following.' });
        }
        currentProfile.followingList = currentProfile.followingList.filter(h => h !== targetHandle);
        await saveUsers(users);
        res.json({ success: true, message: `Successfully unfollowed ${targetHandle}.` });
    } else {
        res.status(400).json({ success: false, message: 'Invalid action.' });
    }
};

app.post('/api/user/follow', (req, res) => toggleFollow(req, res, 'follow'));
app.post('/api/user/unfollow', (req, res) => toggleFollow(req, res, 'unfollow'));

// ========== Search ==========
app.get('/api/search', async (req, res) => {
    const query = req.query.query ? req.query.query.toLowerCase() : '';
    const username = req.query.current_user;
    if (!query) {
        return res.json({ success: true, users: [], posts: [] });
    }
    const feed = await loadFeed();
    const users = await loadUsers();
    const userResults = users
        .filter(user => user.username !== username)
        .filter(user => user.profile && (
            user.profile.name.toLowerCase().includes(query) ||
            user.profile.handle.toLowerCase().includes(query)
        ))
        .map(user => ({
            name: user.profile.name,
            handle: user.profile.handle,
            username: user.username,
            avatar: user.profile.avatar
        }));
    const postResults = feed
        .filter(post => post.content.toLowerCase().includes(query) || post.author.toLowerCase().includes(query));
    const postsWithStatus = postResults.map(post => {
        const authorUser = users.find(u => u.username === post.author);
        const commentsWithAvatar = (post.comments || []).map(comment => {
            const commentUser = users.find(u => u.username === comment.username);
            return {
                ...comment,
                user_avatar: commentUser ? commentUser.profile.avatar : '',
                user_name: commentUser ? commentUser.profile.name : comment.username
            };
        });
        return {
            ...post,
            comments: commentsWithAvatar,
            author_username: authorUser ? authorUser.profile.name : post.author,
            author_handle: authorUser ? authorUser.profile.handle : post.author,
            author_avatar: authorUser ? authorUser.profile.avatar : '',
            user_liked: username ? (post.likedBy || []).includes(username) : false
        };
    });
    res.json({ success: true, users: userResults, posts: postsWithStatus });
});

// ========== Delete Account ==========
app.delete('/api/user/delete', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required.' });
    }
    try {
        let users = await loadUsers();
        let feed = await loadFeed();
        let messages = await loadMessages();
        const userIndex = users.findIndex(u => u.username === username);
        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        const userToDelete = users[userIndex];
        const handleToDelete = userToDelete.profile.handle;
        users.splice(userIndex, 1);
        users.forEach(u => {
            if (u.profile && Array.isArray(u.profile.followingList)) {
                u.profile.followingList = u.profile.followingList.filter(h => h !== handleToDelete);
            }
        });
        feed = feed.filter(post => post.author !== username);
        feed.forEach(post => {
            if (post.likedBy && post.likedBy.includes(username)) {
                post.likedBy = post.likedBy.filter(u => u !== username);
                post.likes = post.likedBy.length;
            }
            if (post.comments) {
                post.comments = post.comments.filter(c => c.username !== username);
            }
        });
        messages = messages.filter(chat => !chat.participants || !chat.participants.includes(username));
        await saveUsers(users);
        await saveFeed(feed);
        await saveMessages(messages);
        res.json({ success: true, message: 'Account deleted successfully.' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, message: 'Server error during account deletion.' });
    }
});

// ============================================================
// USER LIST API
// ============================================================
app.get('/api/users/list', async (req, res) => {
    try {
        const users = await loadUsers();
        const userList = users.map(user => ({
            username: user.username,
            name: user.profile.name,
            handle: user.profile.handle,
            avatar: user.profile.avatar
        }));
        res.json({ success: true, users: userList });
    } catch (error) {
        console.error('Error loading users list:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.get('/api/users/avatars', async (req, res) => {
    try {
        const users = await loadUsers();
        const userAvatars = users.map(user => ({
            username: user.username,
            avatar: user.profile.avatar || ''
        }));
        res.json({ success: true, users: userAvatars });
    } catch (error) {
        console.error('Error loading user avatars:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ============================================================
// MESSAGES API
// ============================================================
app.get('/api/messages/list', async (req, res) => {
    const username = req.query.username;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required.' });
    }
    try {
        const messagesData = await loadMessages();
        const users = await loadUsers();
        const userChats = messagesData.filter(chat => chat.participants && chat.participants.includes(username));
        const chatList = userChats.map(chat => {
            const isGroup = chat.type === 'group';
            const lastMsg = chat.messages && chat.messages.length > 0 ? chat.messages[chat.messages.length - 1] : null;
            const unreadCount = chat.messages ? chat.messages.filter(m => m.sender !== username && !m.read).length : 0;
            let name = chat.name || 'Chat';
            let avatar = '';
            let handle = '';
            if (isGroup) {
                name = chat.name || 'Group Chat';
                handle = `${chat.participants ? chat.participants.length : 0} members`;
            } else {
                const partner = chat.participants ? chat.participants.find(p => p !== username) : null;
                const partnerUser = users.find(u => u.username === partner);
                if (partnerUser) {
                    name = partnerUser.profile.name || partner;
                    avatar = partnerUser.profile.avatar || '';
                    handle = partnerUser.profile.handle || partner;
                } else {
                    name = partner || 'Unknown';
                    handle = partner || 'unknown';
                }
            }
            return {
                id: chat.id,
                type: chat.type || 'direct',
                name: name,
                avatar: avatar,
                handle: handle,
                emoji: chat.emoji,
                participants: chat.participants || [],
                owner: chat.owner,
                admins: chat.admins || [],
                lastMessage: lastMsg ? lastMsg.text : '',
                lastSender: lastMsg ? lastMsg.sender : '',
                updatedAt: chat.updatedAt || chat.createdAt,
                unreadCount: unreadCount,
                messages: chat.messages || []
            };
        });
        chatList.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        res.json({ success: true, chats: chatList });
    } catch (error) {
        console.error('Error loading messages list:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/messages/send', async (req, res) => {
    const { username, chatId, text, replyTo } = req.body;
    if (!username || !chatId || !text) {
        return res.status(400).json({ success: false, message: 'Username, chatId and text are required.' });
    }
    try {
        let messagesData = await loadMessages();
        const users = await loadUsers();
        const chatIndex = messagesData.findIndex(c => c.id === chatId);
        if (chatIndex === -1) {
            return res.status(404).json({ success: false, message: 'Chat not found.' });
        }
        const chat = messagesData[chatIndex];
        if (!chat.participants || !chat.participants.includes(username)) {
            return res.status(403).json({ success: false, message: 'You are not a member of this chat.' });
        }
        const senderUser = users.find(u => u.username === username);
        const senderAvatar = senderUser ? senderUser.profile.avatar : '';
        const newMessage = {
            id: Date.now(),
            sender: username,
            text: text,
            timestamp: new Date().toISOString(),
            read: false,
            avatar: senderAvatar
        };
        if (replyTo && replyTo.id) {
            newMessage.replyTo = {
                id: replyTo.id,
                sender: replyTo.sender,
                text: replyTo.text
            };
        }
        chat.messages.push(newMessage);
        chat.updatedAt = new Date().toISOString();
        await saveMessages(messagesData);
        res.json({ success: true, message: 'Message sent!', chat: chat, message: newMessage });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/messages/read', async (req, res) => {
    const { username, chatId } = req.body;
    if (!username || !chatId) {
        return res.status(400).json({ success: false, message: 'Username and chatId are required.' });
    }
    try {
        let messagesData = await loadMessages();
        const chat = messagesData.find(c => c.id === chatId);
        if (chat) {
            chat.messages = chat.messages.map(msg => {
                if (msg.sender !== username) {
                    return { ...msg, read: true };
                }
                return msg;
            });
            await saveMessages(messagesData);
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking messages as read:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/messages/start', async (req, res) => {
    const { username, partner } = req.body;
    if (!username || !partner) {
        return res.status(400).json({ success: false, message: 'Username and partner are required.' });
    }
    try {
        let messagesData = await loadMessages();
        const users = await loadUsers();
        const userExists = users.find(u => u.username === username);
        const partnerExists = users.find(u => u.username === partner);
        if (!userExists || !partnerExists) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        let chat = messagesData.find(c => c.type !== 'group' && c.participants && c.participants.includes(username) && c.participants.includes(partner));
        if (!chat) {
            const chatId = 'direct_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
            chat = {
                id: chatId,
                type: 'direct',
                participants: [username, partner],
                messages: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            messagesData.push(chat);
            await saveMessages(messagesData);
        }
        res.json({ success: true, chat: chat });
    } catch (error) {
        console.error('Error starting chat:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ========== Create Group ==========
app.post('/api/messages/group/create', async (req, res) => {
    const { username, name, emoji, members } = req.body;
    if (!username || !name || !members || members.length < 2) {
        return res.status(400).json({ success: false, message: 'Group name and at least 2 members are required.' });
    }
    try {
        let messagesData = await loadMessages();
        const users = await loadUsers();
        const allParticipants = [username, ...members];
        for (const participant of allParticipants) {
            const exists = users.find(u => u.username === participant);
            if (!exists) {
                return res.status(404).json({ success: false, message: `User "${participant}" not found.` });
            }
        }
        const groupId = generateGroupId();
        const newGroup = {
            id: groupId,
            type: 'group',
            name: name,
            emoji: emoji || '👥',
            owner: username,
            admins: [],
            participants: allParticipants,
            messages: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        messagesData.push(newGroup);
        await saveMessages(messagesData);
        res.json({ success: true, message: 'Group created successfully!', chat: newGroup });
    } catch (error) {
        console.error('Error creating group:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ============================================================
// GROUP SETTINGS API
// ============================================================
app.get('/api/messages/group/:groupId', async (req, res) => {
    const { groupId } = req.params;
    const username = req.query.username;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required.' });
    }
    try {
        const messagesData = await loadMessages();
        const users = await loadUsers();
        const group = messagesData.find(c => c.id === groupId && c.type === 'group');
        if (!group) {
            return res.status(404).json({ success: false, message: 'Group not found.' });
        }
        if (!group.participants || !group.participants.includes(username)) {
            return res.status(403).json({ success: false, message: 'You are not a member of this group.' });
        }
        const memberDetails = group.participants.map(participant => {
            const user = users.find(u => u.username === participant);
            return {
                username: participant,
                name: user ? user.profile.name : participant,
                handle: user ? user.profile.handle : participant,
                avatar: user ? user.profile.avatar : '',
                isOwner: group.owner === participant,
                isAdmin: group.admins && group.admins.includes(participant)
            };
        });
        const response = {
            ...group,
            memberDetails: memberDetails,
            isOwner: group.owner === username,
            isAdmin: group.admins && group.admins.includes(username)
        };
        res.json({ success: true, group: response });
    } catch (error) {
        console.error('Error getting group details:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.put('/api/messages/group/:groupId', async (req, res) => {
    const { groupId } = req.params;
    const { username, name, emoji } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required.' });
    }
    try {
        let messagesData = await loadMessages();
        const groupIndex = messagesData.findIndex(c => c.id === groupId && c.type === 'group');
        if (groupIndex === -1) {
            return res.status(404).json({ success: false, message: 'Group not found.' });
        }
        const group = messagesData[groupIndex];
        if (!group.participants || !group.participants.includes(username)) {
            return res.status(403).json({ success: false, message: 'You are not a member of this group.' });
        }
        const isOwner = group.owner === username;
        const isAdmin = group.admins && group.admins.includes(username);
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, message: 'Only group owner and admins can update group info.' });
        }
        if (name) group.name = name;
        if (emoji) group.emoji = emoji;
        group.updatedAt = new Date().toISOString();
        await saveMessages(messagesData);
        res.json({ success: true, message: 'Group updated successfully!', group: group });
    } catch (error) {
        console.error('Error updating group:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/messages/group/:groupId/add', async (req, res) => {
    const { groupId } = req.params;
    const { username, newMember } = req.body;
    if (!username || !newMember) {
        return res.status(400).json({ success: false, message: 'Username and newMember are required.' });
    }
    try {
        let messagesData = await loadMessages();
        const users = await loadUsers();
        const groupIndex = messagesData.findIndex(c => c.id === groupId && c.type === 'group');
        if (groupIndex === -1) {
            return res.status(404).json({ success: false, message: 'Group not found.' });
        }
        const group = messagesData[groupIndex];
        if (!group.participants || !group.participants.includes(username)) {
            return res.status(403).json({ success: false, message: 'You are not a member of this group.' });
        }
        const isOwner = group.owner === username;
        const isAdmin = group.admins && group.admins.includes(username);
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, message: 'Only group owner and admins can add members.' });
        }
        const newUser = users.find(u => u.username === newMember);
        if (!newUser) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        if (group.participants.includes(newMember)) {
            return res.status(400).json({ success: false, message: 'User is already in the group.' });
        }
        group.participants.push(newMember);
        group.updatedAt = new Date().toISOString();
        await saveMessages(messagesData);
        res.json({ success: true, message: 'Member added successfully!', group: group });
    } catch (error) {
        console.error('Error adding member:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.delete('/api/messages/group/:groupId/remove', async (req, res) => {
    const { groupId } = req.params;
    const { username, targetMember } = req.body;
    if (!username || !targetMember) {
        return res.status(400).json({ success: false, message: 'Username and targetMember are required.' });
    }
    try {
        let messagesData = await loadMessages();
        const groupIndex = messagesData.findIndex(c => c.id === groupId && c.type === 'group');
        if (groupIndex === -1) {
            return res.status(404).json({ success: false, message: 'Group not found.' });
        }
        const group = messagesData[groupIndex];
        if (!group.participants || !group.participants.includes(username)) {
            return res.status(403).json({ success: false, message: 'You are not a member of this group.' });
        }
        if (username === targetMember) {
            return res.status(400).json({ success: false, message: 'You cannot remove yourself. Use "Leave Group" instead.' });
        }
        const isOwner = group.owner === username;
        const isAdmin = group.admins && group.admins.includes(username);
        const targetIsOwner = group.owner === targetMember;
        const targetIsAdmin = group.admins && group.admins.includes(targetMember);
        if (targetIsOwner) {
            return res.status(403).json({ success: false, message: 'You cannot remove the group owner.' });
        }
        if (targetIsAdmin && !isOwner) {
            return res.status(403).json({ success: false, message: 'Only the group owner can remove admins.' });
        }
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, message: 'Only group owner and admins can remove members.' });
        }
        if (!group.participants.includes(targetMember)) {
            return res.status(404).json({ success: false, message: 'User is not in the group.' });
        }
        group.participants = group.participants.filter(p => p !== targetMember);
        group.admins = group.admins ? group.admins.filter(a => a !== targetMember) : [];
        group.updatedAt = new Date().toISOString();
        await saveMessages(messagesData);
        res.json({ success: true, message: 'Member removed successfully!', group: group });
    } catch (error) {
        console.error('Error removing member:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/messages/group/:groupId/admin', async (req, res) => {
    const { groupId } = req.params;
    const { username, targetMember, action } = req.body;
    if (!username || !targetMember || !action) {
        return res.status(400).json({ success: false, message: 'Username, targetMember and action are required.' });
    }
    if (!['set', 'unset'].includes(action)) {
        return res.status(400).json({ success: false, message: 'Action must be "set" or "unset".' });
    }
    try {
        let messagesData = await loadMessages();
        const groupIndex = messagesData.findIndex(c => c.id === groupId && c.type === 'group');
        if (groupIndex === -1) {
            return res.status(404).json({ success: false, message: 'Group not found.' });
        }
        const group = messagesData[groupIndex];
        if (!group.participants || !group.participants.includes(username)) {
            return res.status(403).json({ success: false, message: 'You are not a member of this group.' });
        }
        if (group.owner !== username) {
            return res.status(403).json({ success: false, message: 'Only the group owner can manage admins.' });
        }
        if (!group.participants.includes(targetMember)) {
            return res.status(404).json({ success: false, message: 'User is not in the group.' });
        }
        if (targetMember === group.owner) {
            return res.status(400).json({ success: false, message: 'Cannot change admin status of the group owner.' });
        }
        if (!group.admins) group.admins = [];
        if (action === 'set') {
            if (group.admins.includes(targetMember)) {
                return res.status(400).json({ success: false, message: 'User is already an admin.' });
            }
            group.admins.push(targetMember);
        } else {
            if (!group.admins.includes(targetMember)) {
                return res.status(400).json({ success: false, message: 'User is not an admin.' });
            }
            group.admins = group.admins.filter(a => a !== targetMember);
        }
        group.updatedAt = new Date().toISOString();
        await saveMessages(messagesData);
        res.json({ success: true, message: action === 'set' ? 'Admin added successfully!' : 'Admin removed successfully!', group: group });
    } catch (error) {
        console.error('Error managing admin:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/messages/group/:groupId/transfer', async (req, res) => {
    const { groupId } = req.params;
    const { username, newOwner } = req.body;
    if (!username || !newOwner) {
        return res.status(400).json({ success: false, message: 'Username and newOwner are required.' });
    }
    try {
        let messagesData = await loadMessages();
        const groupIndex = messagesData.findIndex(c => c.id === groupId && c.type === 'group');
        if (groupIndex === -1) {
            return res.status(404).json({ success: false, message: 'Group not found.' });
        }
        const group = messagesData[groupIndex];
        if (!group.participants || !group.participants.includes(username)) {
            return res.status(403).json({ success: false, message: 'You are not a member of this group.' });
        }
        if (group.owner !== username) {
            return res.status(403).json({ success: false, message: 'Only the group owner can transfer ownership.' });
        }
        if (!group.participants.includes(newOwner)) {
            return res.status(404).json({ success: false, message: 'User is not in the group.' });
        }
        if (group.admins && group.admins.includes(newOwner)) {
            group.admins = group.admins.filter(a => a !== newOwner);
        }
        if (!group.admins) group.admins = [];
        if (!group.admins.includes(username)) {
            group.admins.push(username);
        }
        group.owner = newOwner;
        group.updatedAt = new Date().toISOString();
        await saveMessages(messagesData);
        res.json({ success: true, message: 'Ownership transferred successfully!', group: group });
    } catch (error) {
        console.error('Error transferring ownership:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/messages/group/:groupId/leave', async (req, res) => {
    const { groupId } = req.params;
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required.' });
    }
    try {
        let messagesData = await loadMessages();
        const groupIndex = messagesData.findIndex(c => c.id === groupId && c.type === 'group');
        if (groupIndex === -1) {
            return res.status(404).json({ success: false, message: 'Group not found.' });
        }
        const group = messagesData[groupIndex];
        if (!group.participants || !group.participants.includes(username)) {
            return res.status(403).json({ success: false, message: 'You are not a member of this group.' });
        }
        if (group.owner === username) {
            return res.status(400).json({ success: false, message: 'You are the group owner. Transfer ownership first or delete the group.' });
        }
        group.participants = group.participants.filter(p => p !== username);
        if (group.admins && group.admins.includes(username)) {
            group.admins = group.admins.filter(a => a !== username);
        }
        group.updatedAt = new Date().toISOString();
        await saveMessages(messagesData);
        res.json({ success: true, message: 'You have left the group.', group: group });
    } catch (error) {
        console.error('Error leaving group:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.delete('/api/messages/group/:groupId', async (req, res) => {
    const { groupId } = req.params;
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required.' });
    }
    try {
        let messagesData = await loadMessages();
        const groupIndex = messagesData.findIndex(c => c.id === groupId && c.type === 'group');
        if (groupIndex === -1) {
            return res.status(404).json({ success: false, message: 'Group not found.' });
        }
        const group = messagesData[groupIndex];
        if (group.owner !== username) {
            return res.status(403).json({ success: false, message: 'Only the group owner can delete the group.' });
        }
        messagesData.splice(groupIndex, 1);
        await saveMessages(messagesData);
        res.json({ success: true, message: 'Group deleted successfully.' });
    } catch (error) {
        console.error('Error deleting group:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ============================================================
// REACTION & MESSAGE APIs
// ============================================================
app.post('/api/messages/react', async (req, res) => {
    const { username, messageId, emoji } = req.body;
    if (!username || !messageId || !emoji) {
        return res.status(400).json({ success: false, message: 'Username, messageId and emoji are required.' });
    }
    try {
        let messagesData = await loadMessages();
        let found = false;
        for (const chat of messagesData) {
            const msg = chat.messages.find(m => m.id === messageId);
            if (msg) {
                if (!msg.reactions) msg.reactions = {};
                if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
                const idx = msg.reactions[emoji].indexOf(username);
                if (idx > -1) {
                    msg.reactions[emoji].splice(idx, 1);
                    if (msg.reactions[emoji].length === 0) {
                        delete msg.reactions[emoji];
                    }
                } else {
                    msg.reactions[emoji].push(username);
                }
                found = true;
                chat.updatedAt = new Date().toISOString();
                break;
            }
        }
        if (!found) {
            return res.status(404).json({ success: false, message: 'Message not found.' });
        }
        await saveMessages(messagesData);
        res.json({ success: true, message: 'Reaction updated.' });
    } catch (error) {
        console.error('Error updating reaction:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.delete('/api/messages/delete', async (req, res) => {
    const { username, messageId } = req.body;
    if (!username || !messageId) {
        return res.status(400).json({ success: false, message: 'Username and messageId are required.' });
    }
    try {
        let messagesData = await loadMessages();
        let found = false;
        for (const chat of messagesData) {
            const msgIndex = chat.messages.findIndex(m => m.id === messageId);
            if (msgIndex > -1) {
                const msg = chat.messages[msgIndex];
                if (msg.sender !== username) {
                    return res.status(403).json({ success: false, message: 'You can only delete your own messages.' });
                }
                chat.messages.splice(msgIndex, 1);
                chat.updatedAt = new Date().toISOString();
                found = true;
                break;
            }
        }
        if (!found) {
            return res.status(404).json({ success: false, message: 'Message not found.' });
        }
        await saveMessages(messagesData);
        res.json({ success: true, message: 'Message deleted.' });
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.put('/api/messages/edit', async (req, res) => {
    const { username, messageId, text } = req.body;
    if (!username || !messageId || !text) {
        return res.status(400).json({ success: false, message: 'Username, messageId and text are required.' });
    }
    try {
        let messagesData = await loadMessages();
        let found = false;
        for (const chat of messagesData) {
            const msg = chat.messages.find(m => m.id === messageId);
            if (msg) {
                if (msg.sender !== username) {
                    return res.status(403).json({ success: false, message: 'You can only edit your own messages.' });
                }
                msg.text = text;
                msg.edited = true;
                msg.editedAt = new Date().toISOString();
                chat.updatedAt = new Date().toISOString();
                found = true;
                break;
            }
        }
        if (!found) {
            return res.status(404).json({ success: false, message: 'Message not found.' });
        }
        await saveMessages(messagesData);
        res.json({ success: true, message: 'Message edited.' });
    } catch (error) {
        console.error('Error editing message:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ============================================================
// 启动服务器
// ============================================================
app.get('/', (req, res) => {
    res.redirect('/poSter_home.html');
});

async function startServer() {
    const connected = await connectToMongoDB();
    if (connected) {
        app.listen(PORT, () => {
            console.log(`\n==============================================`);
            console.log(`✅ Server running at http://localhost:${PORT}`);
            console.log(`🏠 Main page: http://localhost:${PORT}/poSter_home.html`);
            console.log(`📦 Database: MongoDB Atlas (${DB_NAME})`);
            console.log(`🖼️  Images: Cloudinary`);
            console.log(`==============================================`);
        });
    } else {
        console.error('❌ Failed to connect to MongoDB. Server not started.');
        process.exit(1);
    }
}

startServer();
