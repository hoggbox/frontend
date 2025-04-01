let token;
let currentLatLng;
let userId;
let isAdmin = false;
let geocoder;
let markers = {};
let userLocationMarker;
let watchId;
let sortDirection = {};
let lastSortedColumn = null;
let currentFilter = 'newest';
let currentPage = 1;
const pinsPerPage = 8;
let searchQuery = '';
let currentProfileUserId;
let ws;
let username;

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

window.initMap = function () {
    map = new google.maps.Map(document.getElementById('map'), {
        zoom: 12,
        styles: [
            { featureType: "all", elementType: "labels.text.fill", stylers: [{ color: "#2c3e50" }] },
            { featureType: "all", elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }, { weight: 2 }] }
        ]
    });
    geocoder = new google.maps.Geocoder();

    token = localStorage.getItem('token');
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            userId = payload.id;
            isAdmin = payload.email === 'imhoggbox@gmail.com';
            fetchProfileForUsername();
            showMap();
            startMap();
            fetchWeatherAlerts();
            setupWebSocket();
            checkNewMessages();
            document.getElementById('admin-btn').style.display = isAdmin ? 'inline-block' : 'none';
        } catch (err) {
            console.error('Invalid token:', err);
            signOut();
        }
    } else {
        showLogin();
    }

    // Profile picture preview for edit profile
    document.getElementById('profile-picture').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                document.getElementById('profile-picture-preview').src = e.target.result;
                document.getElementById('profile-picture-preview').style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    });
};

async function fetchProfileForUsername() {
    try {
        const response = await fetch('https://pinmap-website.onrender.com/auth/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const profile = await response.json();
            username = profile.username || profile.email;
        } else {
            username = null;
        }
    } catch (err) {
        console.error('Error fetching profile:', err);
        username = null;
    }
}

function showLogin() {
    document.getElementById('auth').style.display = 'block';
    document.getElementById('map-container').style.display = 'none';
    document.getElementById('profile-container').style.display = 'none';
    document.getElementById('profile-view-container').style.display = 'none';
    document.getElementById('media-view').style.display = 'none';
    document.getElementById('messages-container').style.display = 'none';
    document.getElementById('admin-panel').style.display = 'none';
}

function showMap() {
    document.getElementById('auth').style.display = 'none';
    document.getElementById('map-container').style.display = 'block';
    document.getElementById('profile-container').style.display = 'none';
    document.getElementById('profile-view-container').style.display = 'none';
    document.getElementById('media-view').style.display = 'none';
    document.getElementById('messages-container').style.display = 'none';
    document.getElementById('admin-panel').style.display = 'none';
    document.getElementById('admin-btn').style.display = isAdmin ? 'inline-block' : 'none';
}

function setupWebSocket() {
    ws = new WebSocket('wss://pinmap-website.onrender.com');
    ws.onopen = () => {
        console.log('WebSocket connected');
        const payload = JSON.parse(atob(token.split('.')[1]));
        fetch(`https://pinmap-website.onrender.com/set-ws-email?email=${encodeURIComponent(payload.email)}&userId=${encodeURIComponent(userId)}`);
    };
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'location' && data.userId === userId && !isAdmin) {
            updateUserLocation(data.latitude, data.longitude);
        } else if (data.type === 'allLocations' && isAdmin) {
            data.locations.forEach(({ userId: uid, email, latitude, longitude }) => {
                const pos = { lat: latitude, lng: longitude };
                if (markers[uid]) {
                    markers[uid].setPosition(pos);
                } else {
                    markers[uid] = new google.maps.Marker({
                        position: pos,
                        map: map,
                        title: email,
                        icon: uid === userId ? 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png' : 'http://maps.google.com/mapfiles/ms/icons/red-dot.png'
                    });
                }
            });
        } else if (data.type === 'chat') {
            addChatMessage(data);
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
    };
    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
    };
}

function addChatMessage(data) {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    messageDiv.innerHTML = `
    <span class="username">${data.username || data.userId || 'Unknown'}</span>:
    ${data.message}
    <span class="timestamp">${new Date(data.timestamp).toLocaleTimeString()}</span>
  `;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    console.log('Chat message added:', data); // Debug
}

function sendChatMessage() {
    const messageInput = document.getElementById('chat-input');
    const message = messageInput.value.trim();
    if (!message) return;
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'chat', userId, username: username || 'Anonymous', message }));
        messageInput.value = '';
    } else {
        alert('Chat connection not available.');
    }
}

function startMap() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
                map.setCenter(userLocation);
                updateUserLocation(userLocation.lat, userLocation.lng);
                fetchPins();
                startLocationTracking();
            },
            (error) => {
                console.error('Geolocation error:', error);
                map.setCenter({ lat: 33.0801, lng: -83.2321 });
                fetchPins();
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    } else {
        map.setCenter({ lat: 33.0801, lng: -83.2321 });
        fetchPins();
    }

    map.addListener('click', (e) => {
        if (token) {
            currentLatLng = { lat: e.latLng.lat(), lng: e.latLng.lng() };
            new google.maps.Marker({
                position: currentLatLng,
                map: map,
                icon: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png',
            });
        }
    });
}

function startLocationTracking() {
    if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(
            (position) => {
                const userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
                if (!isAdmin) updateUserLocation(userLocation.lat, userLocation.lng);
                if (ws.readyState === WebSocket.OPEN) {
                    const payload = JSON.parse(atob(token.split('.')[1]));
                    ws.send(JSON.stringify({
                        type: 'location',
                        userId,
                        email: payload.email,
                        latitude: userLocation.lat,
                        longitude: userLocation.lng
                    }));
                }
                fetch('https://pinmap-website.onrender.com/auth/location', {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ latitude: userLocation.lat, longitude: userLocation.lng })
                }).catch(err => console.error('Error updating location:', err));
            },
            (error) => {
                console.error('Tracking error:', error);
                if (error.code === error.PERMISSION_DENIED && userLocationMarker) {
                    userLocationMarker.setMap(null);
                    userLocationMarker = null;
                    map.setCenter({ lat: 33.0801, lng: -83.2321 });
                }
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 }
        );
    }
}

function updateUserLocation(lat, lng) {
    const userLocation = { lat, lng };
    if (!userLocationMarker) {
        userLocationMarker = new google.maps.Marker({
            position: userLocation,
            map: map,
            title: 'Your Location',
            icon: {
                path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 6,
                fillColor: '#0000FF',
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: '#FFFFFF'
            }
        });
    } else {
        userLocationMarker.setPosition(userLocation);
    }
    if (!isAdmin) map.setCenter(userLocation);
}

async function searchAddress() {
    const address = document.getElementById('address-search').value;
    if (!address) return alert('Please enter an address');
    geocoder.geocode({ address }, (results, status) => {
        if (status === 'OK') {
            const location = results[0].geometry.location;
            map.setCenter(location);
            map.setZoom(15);
            if (!isAdmin) alert('Non-admin users can only view their current location.');
            else {
                new google.maps.Marker({
                    position: location,
                    map: map,
                    title: address,
                    icon: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png',
                });
            }
        } else {
            alert('Address not found: ' + status);
        }
    });
}

// Make login a global function
window.login = async function() {
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const stayLoggedInInput = document.getElementById('stay-logged-in');

    if (!emailInput || !passwordInput || !stayLoggedInInput) {
        console.error('Login form elements not found');
        alert('Login form is not properly set up. Please check the HTML.');
        return;
    }

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    const stayLoggedIn = stayLoggedInInput.checked;

    if (!email || !password) {
        alert('Please enter both email and password');
        return;
    }

    try {
        const response = await fetch('https://pinmap-website.onrender.com/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, stayLoggedIn }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            alert(`Login failed: ${errorText || 'Invalid credentials'}`);
            return;
        }

        const data = await response.json();
        if (data.token) {
            token = data.token;
            localStorage.setItem('token', token);
            const payload = JSON.parse(atob(token.split('.')[1]));
            userId = payload.id;
            isAdmin = payload.email === 'imhoggbox@gmail.com';
            fetchProfileForUsername();
            showMap();
            startMap();
            fetchWeatherAlerts();
            setupWebSocket();
            checkNewMessages();
        } else {
            alert(`Login failed: ${data.message || 'No token received'}`);
        }
    } catch (err) {
        console.error('Login error:', err);
        alert('Error during login. Please try again.');
    }
}

function signOut() {
    localStorage.removeItem('token');
    token = null;
    userId = null;
    isAdmin = false;
    username = null;
    if (userLocationMarker) userLocationMarker.setMap(null);
    userLocationMarker = null;
    if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    watchId = undefined;
    if (ws) ws.close();
    Object.values(markers).forEach(marker => marker.setMap(null));
    markers = {};
    showLogin();
    document.getElementById('pin-list').innerHTML = '';
    document.getElementById('chat-messages').innerHTML = '';
    document.getElementById('alert-counter').textContent = 'Current Alerts: 0';
    document.getElementById('weather-content').textContent = 'Loading weather alerts...';
    document.getElementById('messages-btn').textContent = 'Messages';
}

async function addPin() {
  if (!currentLatLng) return alert('Click the map to select a location!');

  const pinType = document.getElementById('pin-type').value;
  const descriptionInput = document.getElementById('description').value.trim();
  const description = descriptionInput || pinType;
  const mediaFile = document.getElementById('media-upload').files[0];

  const formData = new FormData();
  formData.append('latitude', currentLatLng.lat);
  formData.append('longitude', currentLatLng.lng);
  formData.append('description', description);
  if (mediaFile) formData.append('media', mediaFile);

  try {
    const response = await fetch('https://pinmap-website.onrender.com/pins', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Add alert failed:', response.status, errorText);
      alert(`Failed to add alert: ${errorText || 'Unknown error'}`);
      return;
    }

    fetchPins();
    document.getElementById('pin-type').value = '';
    document.getElementById('description').value = '';
    document.getElementById('media-upload').value = '';
    currentLatLng = null;

  } catch (err) {
    console.error('Add alert error:', err);
    alert('Error adding alert. Please try again.');
  }
}

async function extendPin(pinId) {
    try {
        const response = await fetch(`https://pinmap-website.onrender.com/pins/extend/${pinId}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            // Log non-JSON error
            const errorText = await response.text();
            console.error('Extend pin error (non-JSON):', response.status, errorText);
            alert(`Error: ${errorText}`);
            return;
        }

        const result = await response.json(); // Try to parse JSON
        alert('Pin expiration extended by 2 hours');
        fetchPins();
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

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Verify pin error (non-JSON):', response.status, errorText);
            alert(`Error: ${errorText}`);
            return;
        }

        const result = await response.json();
        alert(`Pin verified. Verifications: ${result.verifications}${result.verified ? ' (Verified)' : ''}`);
        fetchPins();
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

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Show comments error (non-JSON):', response.status, errorText);
            alert(`Error: ${errorText}`);
            return;
        }

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
      <span class="
