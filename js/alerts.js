// js/alerts.js

let token = localStorage.getItem('token');
let userId;
let isAdmin = false;
let ws;
let username;
let markers = {};
let currentProfileUserId;
let currentFilter = 'newest';
let currentPage = 1;
const pinsPerPage = 8;
let searchQuery = '';
let sortDirection = {};
let lastSortedColumn = null;
let isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

function checkAuth() {
    if (!token) {
        window.location.href = 'index.html';
        return;
    }
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        userId = payload.id;
        isAdmin = payload.email === 'imhoggbox@gmail.com';
        fetchProfileForUsername();
        setupWebSocket();
        fetchPins();
        checkNewMessages();
        document.getElementById('admin-btn').style.display = isAdmin ? 'inline-block' : 'none';
        if (isMobile) {
            document.getElementById('mobile-admin-btn').style.display = isAdmin ? 'inline-block' : 'none';
        }
        setupMenuDropdown();
    } catch (err) {
        console.error('Invalid token:', err);
        signOut();
    }
}

function setupMenuDropdown() {
    const menuBtn = document.getElementById('menu-btn');
    const menuDropdown = document.getElementById('menu-dropdown');
    if (menuBtn && menuDropdown) {
        menuBtn.addEventListener('click', () => {
            menuDropdown.classList.toggle('show');
        });
    }
}

async function fetchProfileForUsername() {
    try {
        const response = await fetch('https://pinmap-website.onrender.com/auth/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const profile = await response.json();
            username = profile.username || profile.email;
        } else {
            throw new Error('Failed to fetch profile');
        }
    } catch (err) {
        console.error('Error fetching profile:', err);
        username = null;
    }
}

function setupWebSocket() {
    ws = new WebSocket('wss://pinmap-website.onrender.com');
    ws.onopen = () => {
        console.log('WebSocket connected');
        const payload = JSON.parse(atob(token.split('.')[1]));
        ws.send(JSON.stringify({
            type: 'auth',
            userId: payload.id,
            email: payload.email,
            token: token
        }));
    };
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('WebSocket message:', data);
        if (data.type === 'chat') {
            // Chat messages are handled on the chat page
        } else if (data.type === 'privateMessage') {
            checkNewMessages();
        } else if (data.type === 'newPin') {
            fetchPins();
        } else if (data.type === 'newComment') {
            const pinId = data.pinId;
            if (document.getElementById(`comment-modal-${pinId}`)) {
                showComments(pinId);
            }
            fetchPins();
        }
    };
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        alert('WebSocket connection lost. Please refresh the page.');
    };
    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        alert('WebSocket error occurred. Check your connection.');
    };
}

function signOut() {
    localStorage.removeItem('token');
    token = null;
    userId = null;
    isAdmin = false;
    username = null;
    if (ws) ws.close();
    Object.values(markers).forEach(marker => marker.setMap(null));
    markers = {};
    window.location.href = 'index.html';
}

function showChatPage() {
    window.location.href = 'chat.html';
}

function editProfile() {
    window.location.href = 'profile.html';
}

async function fetchPins() {
    console.log('fetchPins() started');
    try {
        const pinResponse = await fetch('https://pinmap-website.onrender.com/pins', {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        console.log('Fetch response status:', pinResponse.status);
        if (pinResponse.status === 401) {
            signOut();
            return alert('Session expired. Please log in again.');
        }
        if (!pinResponse.ok) {
            throw new Error(`Failed to fetch pins: ${pinResponse.statusText}`);
        }
        let pins = await pinResponse.json();
        console.log('Raw fetched pins:', JSON.stringify(pins, null, 2));

        let trafficCameras = [];
        try {
            const cameraResponse = await fetch('https://pinmap-website.onrender.com/traffic-cameras');
            if (cameraResponse.ok) {
                trafficCameras = await cameraResponse.json();
                console.log('Fetched traffic cameras:', JSON.stringify(trafficCameras, null, 2));
            } else {
                console.warn('Failed to fetch traffic cameras:', cameraResponse.statusText);
            }
        } catch (err) {
            console.warn('Error fetching traffic cameras:', err);
        }

        const formattedCameras = trafficCameras.map(cam => ({
            _id: cam.cameraId,
            description: cam.description,
            latitude: cam.latitude,
            longitude: cam.longitude,
            createdAt: cam.lastUpdated,
            userId: { _id: 'system', username: 'System' },
            pinType: 'traffic-camera',
            verifications: [],
            voteCount: 0,
            comments: [],
            imageUrl: cam.imageUrl
        }));

        pins = [...pins, ...formattedCameras];

        const filteredPins = applyFilter(pins.filter(pin => pin.pinType !== 'traffic-camera'));

        Object.keys(markers).forEach(pinId => {
            if (!pins.some(pin => pin._id === pinId)) {
                if (markers[pinId]) {
                    markers[pinId].setMap(null);
                    delete markers[pinId];
                }
            }
        });

        const pinList = document.getElementById('pin-list');
        if (!pinList) {
            console.error('Pin list element not found in DOM!');
            return;
        }
        pinList.innerHTML = `
            <table class="pin-table">
                <thead>
                    <tr>
                        <th class="sortable" onclick="sortTable('Description')">Description</th>
                        <th class="sortable" onclick="sortTable('Latitude')">Latitude</th>
                        <th class="sortable" onclick="sortTable('Longitude')">Longitude</th>
                        <th class="sortable" onclick="sortTable('Posted By')">Posted By</th>
                        <th class="sortable" onclick="sortTable('Timestamp (ET)')">Timestamp (ET)</th>
                        <th>Expires</th>
                        <th>Media</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
            <div id="pagination" class="pagination-container"></div>
        `;

        const tableBody = pinList.querySelector('tbody');
        const start = (currentPage - 1) * pinsPerPage;
        const end = start + pinsPerPage;
        const paginatedPins = filteredPins.slice(start, end);
        console.log('Paginated pins count:', paginatedPins.length);

        if (paginatedPins.length === 0) {
            console.warn('No pins to display after filtering/pagination');
            tableBody.innerHTML = '<tr><td colspan="8">No pins available</td></tr>';
        }

        pins.forEach(pin => {
            if (pin.pinType === 'traffic-camera') return;

            const isOwnPin = pin.userId._id === userId;
            const canRemove = isAdmin || isOwnPin;
            const isAlertPin = pin.pinType === 'alert';

            console.log(`Pin ID: ${pin._id}, Type: ${pin.pinType}, IsAlert: ${isAlertPin}, CanRemove: ${canRemove}, Verifications: ${pin.verifications.length}, Votes: ${pin.voteCount}`);

            const row = document.createElement('tr');
            row.innerHTML = `
                <td data-label="Description">${pin.description}</td>
                <td data-label="Latitude">${pin.latitude.toFixed(4)}</td>
                <td data-label="Longitude">${pin.longitude.toFixed(4)}</td>
                <td data-label="Posted By">
                    <span onclick="viewProfile('${pin.userId._id}')" style="cursor: pointer; color: #3498db;">
                        ${pin.username || pin.userEmail}
                        <img src="https://img.icons8.com/small/16/visible.png" class="profile-view-icon">
                    </span>
                </td>
                <td data-label="Timestamp (ET)">${new Date(pin.createdAt).toLocaleString()}</td>
                <td data-label="Expires">${pin.expiresAt ? new Date(pin.expiresAt).toLocaleString() : 'Permanent'}</td>
                <td data-label="Media">
                    ${pin.media ? `
                        <img src="https://img.icons8.com/small/20/image.png" class="media-view-icon" onclick="viewMedia('${pin.media}')">
                    ` : 'N/A'}
                </td>
                <td data-label="Actions">
                    <div class="action-buttons">
                        <button class="standard-btn goto-btn" onclick="goToPinLocation(${pin.latitude}, ${pin.longitude})">Go To</button>
                        <button class="standard-btn remove-btn" onclick="${canRemove ? `removePin('${pin._id}')` : `alert('You can only remove your own pins unless you are an admin')`}" ${!canRemove ? 'disabled' : ''}>Remove</button>
                        ${isAlertPin ? `
                            <button class="standard-btn extend-btn" onclick="${canRemove ? `extendPin('${pin._id}')` : `alert('Only the pin owner or admin can extend')`}" ${!canRemove ? 'disabled' : ''}>Extend</button>
                            <button class="standard-btn verify-btn" onclick="verifyPin('${pin._id}')">Verify (${pin.verifications.length})</button>
                            <button class="standard-btn vote-btn" onclick="voteToRemove('${pin._id}')">Vote (${pin.voteCount}/8)</button>
                        ` : ''}
                        <button class="standard-btn comment-btn" onclick="showComments('${pin._id}')">Comments (${pin.comments.length})</button>
                    </div>
                    ${isMobile ? `<div class="action-btn" onclick='showToolsModal(${JSON.stringify(pin)})'>Actions</div>` : ''}
                </td>
            `;
            console.log(`Rendered row for pin ${pin._id} with actions: ${row.querySelector('.action-buttons').innerHTML}`);
            tableBody.appendChild(row);
        });

        const totalPages = Math.ceil(filteredPins.length / pinsPerPage);
        currentPage = Math.min(currentPage, totalPages || 1);
        const paginationContainer = document.getElementById('pagination');
        paginationContainer.innerHTML = `
            <button class="standard-btn prev-btn" onclick="changePage(-1)" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
            <span>Page ${currentPage} of ${totalPages || 1}</span>
            <button class="standard-btn next-btn" onclick="changePage(1)" ${currentPage === totalPages || totalPages === 0 ? 'disabled' : ''}>Next</button>
        `;
    } catch (err) {
        console.error('Fetch pins error:', err);
        alert('Error fetching pins: ' + err.message);
    }
}

function applyFilter(pins) {
    let filteredPins = [...pins];
    if (searchQuery) {
        const queryLower = searchQuery.toLowerCase();
        filteredPins = filteredPins.filter(pin => 
            (pin.username && pin.username.toLowerCase().includes(queryLower)) ||
            (pin.userEmail && pin.userEmail.toLowerCase().includes(queryLower))
        );
    }
    switch (currentFilter) {
        case 'newest': filteredPins.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); break;
        case 'oldest': filteredPins.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); break;
        case 'myPins': filteredPins = filteredPins.filter(pin => pin.userId._id === userId); break;
    }
    return filteredPins;
}

function sortTable(column) {
    if (lastSortedColumn === column) sortDirection[column] = !sortDirection[column];
    else {
        sortDirection[column] = true;
        lastSortedColumn = column;
    }
    fetchPins();
}

function changePage(delta) {
    currentPage += delta;
    fetchPins();
}

function goToPinLocation(lat, lng) {
    // Redirect to map page with coordinates to center on
    localStorage.setItem('centerLat', lat);
    localStorage.setItem('centerLng', lng);
    window.location.href = 'index.html';
}

async function extendPin(pinId) {
    try {
        const response = await fetch(`https://pinmap-website.onrender.com/pins/extend/${pinId}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            alert('Pin expiration extended by 2 hours');
            fetchPins();
            if (isMobile) closeToolsModal();
        } else {
            const errorData = await response.json();
            alert(errorData.message || 'Failed to extend pin');
        }
    } catch (err) {
        console.error('Extend pin error:', err);
        alert('Error extending pin');
    }
}

async function verifyPin(pinId) {
    try {
        const response = await fetch(`https://pinmap-website.onrender.com/pins/verify/${pinId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await response.json();
        if (response.ok) {
            alert(`Pin verified. Verifications: ${result.verifications}${result.verified ? ' (Verified)' : ''}`);
            fetchPins();
            if (isMobile) closeToolsModal();
        } else {
            alert(result.message || 'Failed to verify pin');
        }
    } catch (err) {
        console.error('Verify pin error:', err);
        alert('Error verifying pin');
    }
}

async function showComments(pinId) {
    try {
        const response = await fetch(`https://pinmap-website.onrender.com/pins/comments/${pinId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const comments = await response.json();
            const commentModal = document.createElement('div');
            commentModal.className = 'comment-modal';
            commentModal.id = `comment-modal-${pinId}`;
            commentModal.innerHTML = `
                <h3>Comments</h3>
                <div class="comment-list" id="comment-list-${pinId}"></div>
                <div class="comment-input-container">
                    <input type="text" id="comment-input-${pinId}" placeholder="Add a comment...">
                    <button class="post-btn" onclick="addComment('${pinId}')">Post</button>
                </div>
                <button class="close-btn" onclick="closeComments()">Close</button>
            `;
            document.body.appendChild(commentModal);
            renderComments(pinId, comments);
        } else {
            const errorData = await response.json();
            alert(`Failed to fetch comments: ${errorData.message || 'Unknown error'}`);
        }
    } catch (err) {
        console.error('Fetch comments error:', err);
        alert('Error fetching comments');
    }
}

function renderComments(pinId, comments, parentElementId = `comment-list-${pinId}`, level = 0) {
    const commentList = document.getElementById(parentElementId);
    commentList.innerHTML = '';
    const paginatedComments = comments.slice(0, 8);
    paginatedComments.forEach(comment => {
        const commentDiv = document.createElement('div');
        commentDiv.className = `comment-item ${level > 0 ? 'reply' : ''}`;
        commentDiv.innerHTML = `
            <span class="username">${comment.username}</span>:
            ${comment.content}
            <span class="timestamp">${new Date(comment.timestamp).toLocaleString()}</span>
            <div class="comment-actions">
                <button class="like-btn" onclick="likeComment('${comment._id}')">Like (${comment.likes.length})</button>
                <button class="dislike-btn" onclick="dislikeComment('${comment._id}')">Dislike (${comment.dislikes.length})</button>
                <button class="reply-btn" onclick="showReplyInput('${pinId}', '${comment._id}')">Reply</button>
            </div>
            <div id="replies-${comment._id}" class="comment-list"></div>
        `;
        commentList.appendChild(commentDiv);
        if (comment.replies.length > 0) {
            renderComments(pinId, comment.replies, `replies-${comment._id}`, level + 1);
        }
    });
}

async function addComment(pinId, parentCommentId = null) {
    const commentInput = document.getElementById(`comment-input-${pinId}`);
    const content = commentInput ? commentInput.value.trim() : '';
    const replyInput = parentCommentId ? document.getElementById(`reply-input-${parentCommentId}`) : null;
    const replyContent = replyInput ? replyInput.value.trim() : '';
    const finalContent = replyContent || content;

    if (!finalContent) return alert('Comment cannot be empty');
    try {
        const response = await fetch(`https://pinmap-website.onrender.com/pins/comment/${pinId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: finalContent, parentCommentId })
        });
        if (response.ok) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'newComment', pinId }));
            }
            closeComments();
            showComments(pinId);
        } else {
            const errorData = await response.json();
            alert(errorData.message || 'Failed to add comment');
        }
    } catch (err) {
        console.error('Add comment error:', err);
        alert('Error adding comment');
    }
}

function showReplyInput(pinId, parentCommentId) {
    const replyContainer = document.getElementById(`replies-${parentCommentId}`);
    const existingInput = replyContainer.querySelector('.comment-input-container');
    if (existingInput) return;
    const replyInput = document.createElement('div');
    replyInput.className = 'comment-input-container';
    replyInput.innerHTML = `
        <input type="text" id="reply-input-${parentCommentId}" placeholder="Add a reply...">
        <button class="post-btn" onclick="addComment('${pinId}', '${parentCommentId}')">Post</button>
    `;
    replyContainer.appendChild(replyInput);
}

async function likeComment(commentId) {
    try {
        const response = await fetch(`https://pinmap-website.onrender.com/pins/comment/${commentId}/like`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const pinId = document.querySelector('.comment-modal').id.split('-')[2];
            closeComments();
            showComments(pinId);
        } else {
            const errorData = await response.json();
            alert(errorData.message || 'Failed to like comment');
        }
    } catch (err) {
        console.error('Like comment error:', err);
        alert('Error liking comment');
    }
}

async function dislikeComment(commentId) {
    try {
        const response = await fetch(`https://pinmap-website.onrender.com/pins/comment/${commentId}/dislike`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const pinId = document.querySelector('.comment-modal').id.split('-')[2];
            closeComments();
            showComments(pinId);
        } else {
            const errorData = await response.json();
            alert(errorData.message || 'Failed to dislike comment');
        }
    } catch (err) {
        console.error('Dislike comment error:', err);
        alert('Error disliking comment');
    }
}

function closeComments() {
    const commentModal = document.querySelector('.comment-modal');
    if (commentModal) commentModal.remove();
}

async function removePin(pinId) {
    try {
        const response = await fetch(`https://pinmap-website.onrender.com/pins/${pinId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (response.ok) {
            if (markers[pinId]) {
                markers[pinId].setMap(null);
                delete markers[pinId];
            }
            fetchPins();
            if (isMobile) closeToolsModal();
        } else if (response.status === 401) {
            signOut();
            alert('Session expired. Please log in again.');
        } else {
            const errorData = await response.json();
            alert(errorData.message || 'Failed to remove pin');
        }
    } catch (err) {
        console.error('Remove pin error:', err);
        alert('Error removing pin');
    }
}

async function voteToRemove(pinId) {
    try {
        const response = await fetch(`https://pinmap-website.onrender.com/pins/vote/${pinId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await response.json();
        if (response.ok) {
            if (result.removed) {
                if (markers[pinId]) {
                    markers[pinId].setMap(null);
                    delete markers[pinId];
                }
                alert('Pin removed due to votes');
            } else {
                alert(`Vote recorded. Votes: ${result.voteCount}/8`);
            }
            fetchPins();
            if (isMobile) closeToolsModal();
        } else {
            alert(result.message || 'Failed to vote');
        }
    } catch (err) {
        console.error('Vote error:', err);
        alert('Error voting');
    }
}

function showToolsModal(pin) {
    const modal = document.createElement('div');
    modal.className = 'tools-modal';
    modal.id = `tools-modal-${pin._id}`;
    const isOwnPin = pin.userId._id === userId;
    const canRemove = isAdmin || isOwnPin;
    const isAlertPin = pin.pinType === 'alert';
    modal.innerHTML = `
        <div class="tools-modal-content">
            <h3>Pin Actions</h3>
            <div class="action-buttons">
                <button class="standard-btn goto-btn" onclick="goToPinLocation(${pin.latitude}, ${pin.longitude})">Go To</button>
                <button class="standard-btn remove-btn" onclick="${canRemove ? `removePin('${pin._id}')` : `alert('You can only remove your own pins unless you are an admin')`}" ${!canRemove ? 'disabled' : ''}>Remove</button>
                ${isAlertPin ? `
                    <button class="standard-btn extend-btn" onclick="${canRemove ? `extendPin('${pin._id}')` : `alert('Only the pin owner or admin can extend')`}" ${!canRemove ? 'disabled' : ''}>Extend</button>
                    <button class="standard-btn verify-btn" onclick="verifyPin('${pin._id}')">Verify (${pin.verifications.length})</button>
                    <button class="standard-btn vote-btn" onclick="voteToRemove('${pin._id}')">Vote (${pin.voteCount}/8)</button>
                ` : ''}
                <button class="standard-btn comment-btn" onclick="showComments('${pin._id}')">Comments (${pin.comments.length})</button>
                <button class="standard-btn close-btn" onclick="closeToolsModal()">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function closeToolsModal() {
    const modal = document.querySelector('.tools-modal');
    if (modal) modal.remove();
}

function viewMedia(mediaPath) {
    const mediaView = document.getElementById('media-view');
    const mediaImage = document.getElementById('media-image');
    const mediaVideo = document.getElementById('media-video');
    mediaImage.style.display = 'none';
    mediaVideo.style.display = 'none';
    if (mediaPath.endsWith('.mp4') || mediaPath.endsWith('.webm')) {
        mediaVideo.src = `https://pinmap-website.onrender.com${mediaPath}`;
        mediaVideo.style.display = 'block';
    } else {
        mediaImage.src = `https://pinmap-website.onrender.com${mediaPath}`;
        mediaImage.style.display = 'block';
    }
    mediaView.style.display = 'flex';
}

function closeMediaView() {
    const mediaVideo = document.getElementById('media-video');
    mediaVideo.pause();
    mediaVideo.src = '';
    document.getElementById('media-image').src = '';
    document.getElementById('media-view').style.display = 'none';
}

async function viewProfile(userIdToView) {
    currentProfileUserId = userIdToView;
    try {
        const response = await fetch(`https://pinmap-website.onrender.com/auth/profile/${userIdToView}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const profile = await response.json();
            const viewPic = document.getElementById('view-profile-picture');
            viewPic.src = profile.profilePicture ? 
                `https://pinmap-website.onrender.com${profile.profilePicture}` : 'https://via.placeholder.com/150';
            viewPic.style.display = 'block';
            document.getElementById('view-username').textContent = profile.username || profile.email;
            document.getElementById('view-location').textContent = profile.location || 'Not set';
            document.getElementById('view-pin-count').textContent = profile.totalPins || 0;
            document.getElementById('view-pin-stars').innerHTML = '★'.repeat(Math.floor(profile.reputation / 10));
            document.getElementById('view-reputation').textContent = profile.reputation || 0;
            document.getElementById('view-badges').textContent = profile.badges ? profile.badges.join(', ') : 'None';
            document.getElementById('profile-view-container').style.display = 'block';
        } else {
            const errorData = await response.json();
            alert(`Failed to fetch user profile: ${errorData.message || 'Unknown error'}`);
        }
    } catch (err) {
        console.error('View profile error:', err);
        alert('Error viewing profile');
    }
}

function closeProfileView() {
    document.getElementById('profile-view-container').style.display = 'none';
}

async function upvoteUser() {
    try {
        const response = await fetch(`https://pinmap-website.onrender.com/auth/upvote/${currentProfileUserId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            viewProfile(currentProfileUserId);
        } else {
            const errorData = await response.json();
            alert(errorData.message || 'Failed to upvote user');
        }
    } catch (err) {
        console.error('Upvote error:', err);
        alert('Error upvoting user');
    }
}

async function downvoteUser() {
    try {
        const response = await fetch(`https://pinmap-website.onrender.com/auth/downvote/${currentProfileUserId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            viewProfile(currentProfileUserId);
        } else {
            const errorData = await response.json();
            alert(errorData.message || 'Failed to downvote user');
        }
    } catch (err) {
        console.error('Downvote error:', err);
        alert('Error downvoting user');
    }
}

async function sendPrivateMessage() {
    const messageInput = document.getElementById('message-input');
    const message = messageInput.value.trim();
    if (!message) return alert('Message cannot be empty');
    try {
        const response = await fetch(`https://pinmap-website.onrender.com/auth/message/${currentProfileUserId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: message })
        });
        if (response.ok) {
            messageInput.value = '';
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'privateMessage', senderId: userId, recipientId: currentProfileUserId, content: message }));
            }
            alert('Message sent');
        } else {
            const errorData = await response.json();
            alert(`Failed to send message: ${errorData.message || 'Unknown error'}`);
        }
    } catch (err) {
        console.error('Send message error:', err);
        alert('Error sending message');
    }
}

async function fetchMessages(type = 'inbox') {
    window.location.href = 'messages.html';
}

async function checkNewMessages() {
    try {
        const response = await fetch('https://pinmap-website.onrender.com/auth/messages/inbox', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const messages = await response.json();
            const unreadCount = messages.filter(msg => !msg.read).length;
            const messagesBtn = document.getElementById('messages-btn');
            if (messagesBtn) {
                messagesBtn.textContent = `Messages${unreadCount > 0 ? ` (${unreadCount})` : ''}`;
                messagesBtn.setAttribute('data-unread', unreadCount);
            }
            if (isMobile) {
                const mobileMessagesBtn = document.getElementById('mobile-messages-btn');
                if (mobileMessagesBtn) {
                    mobileMessagesBtn.textContent = `Messages${unreadCount > 0 ? ` (${unreadCount})` : ''}`;
                    mobileMessagesBtn.setAttribute('data-unread', unreadCount);
                }
            }
        }
    } catch (err) {
        console.error('Check messages error:', err);
    }
}

function showAdminPanel() {
    window.location.href = 'admin.html';
}

document.getElementById('pin-filter').onchange = (e) => {
    currentFilter = e.target.value;
    currentPage = 1;
    fetchPins();
};

document.getElementById('pin-search').oninput = (e) => {
    searchQuery = e.target.value.trim();
    currentPage = 1;
    fetchPins();
};

checkAuth();
