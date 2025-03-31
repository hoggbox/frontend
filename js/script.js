let map;
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

function initMap() {
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
    }
  };
  ws.onclose = () => console.log('WebSocket disconnected');
}

function addChatMessage(data) {
  const chatMessages = document.getElementById('chat-messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message';
  messageDiv.innerHTML = `
    <span class="username">${data.username || 'Unknown'}</span>:
    ${data.message}
    <span class="timestamp">${new Date(data.timestamp).toLocaleTimeString()}</span>
  `;
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChatMessage() {
  const messageInput = document.getElementById('chat-input');
  const message = messageInput.value.trim();
  if (!message) return;
  if (!username) {
    if (confirm('You need a username to chat. Set one in your profile?')) editProfile();
    return;
  }
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'chat', userId, username, message }));
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

async function login() {
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
    console.log('Attempting login with:', { email, password, stayLoggedIn });
    const response = await fetch('https://pinmap-website.onrender.com/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, stayLoggedIn }),
    }).catch(err => {
      console.error('Fetch error:', err);
      throw new Error(`Network error: ${err.message}. Is the server running on https://pinmap-website.onrender.com?`);
    });

    console.log('Login response:', response);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Login failed with status:', response.status, errorText);
      alert(`Login failed: ${errorText || 'Invalid credentials'} (Status: ${response.status})`);
      return;
    }

    const data = await response.json();
    console.log('Login data:', data);

    if (data.token) {
      token = data.token;
      localStorage.setItem('token', token);
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        userId = payload.id;
        isAdmin = payload.email === 'imhoggbox@gmail.com';
        console.log('User logged in:', { userId, isAdmin });
        fetchProfileForUsername();
        showMap();
        startMap();
        fetchWeatherAlerts();
        setupWebSocket();
        checkNewMessages();
      } catch (err) {
        console.error('Token parsing error:', err);
        alert('Invalid token received. Please try again.');
      }
    } else {
      alert(`Login failed: ${data.message || 'No token received'}`);
    }
  } catch (err) {
    console.error('Login error:', err);
    alert(err.message);
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
  const response = await fetch('https://pinmap-website.onrender.com/pins', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (response.status === 401) {
    signOut();
    return alert('Session expired. Please log in again.');
  }
  const pins = await response.json();
  const tooClose = pins.some(pin => getDistance(currentLatLng.lat, currentLatLng.lng, pin.latitude, pin.longitude) < 304.8);
  if (tooClose) {
    alert('Alert cannot be within 1000 feet of an existing alert.');
    currentLatLng = null;
    return;
  }

  const pinType = document.getElementById('pin-type').value;
  const descriptionInput = document.getElementById('description').value;
  const description = pinType || descriptionInput;
  const mediaFile = document.getElementById('media-upload').files[0];
  const formData = new FormData();
  formData.append('latitude', currentLatLng.lat);
  formData.append('longitude', currentLatLng.lng);
  formData.append('description', description);
  if (mediaFile) formData.append('media', mediaFile);

  const postResponse = await fetch('https://pinmap-website.onrender.com/pins', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  });
  if (postResponse.ok) {
    fetchPins();
    document.getElementById('pin-type').value = '';
    document.getElementById('description').value = '';
    document.getElementById('media-upload').value = '';
    currentLatLng = null;
  } else if (postResponse.status === 401) {
    signOut();
    alert('Session expired. Please log in again.');
  } else {
    alert(`Failed to add alert: ${await postResponse.text()}`);
  }
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
    } else {
      alert(await response.text());
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
    } else {
      alert(result.message);
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
      alert('Failed to fetch comments');
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
      closeComments(); // Close modal after posting
      showComments(pinId); // Reopen with updated comments
    } else {
      alert(await response.text());
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
      alert(await response.text());
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
      alert(await response.text());
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
    } else if (response.status === 401) {
      signOut();
      alert('Session expired. Please log in again.');
    } else {
      alert(await response.text());
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
    } else {
      alert(result.message);
    }
  } catch (err) {
    console.error('Vote error:', err);
    alert('Error voting');
  }
}

function goToPinLocation(lat, lng) {
  map.setCenter({ lat: parseFloat(lat), lng: parseFloat(lng) });
  map.setZoom(15);
}

function sortTable(pins, column) {
  if (lastSortedColumn === column) sortDirection[column] = !sortDirection[column];
  else {
    sortDirection[column] = true;
    lastSortedColumn = column;
  }
  return pins.sort((a, b) => {
    let valA, valB;
    switch (column) {
      case 'Description': valA = a.description.toLowerCase(); valB = b.description.toLowerCase(); break;
      case 'Latitude': valA = a.latitude; valB = b.latitude; break;
      case 'Longitude': valA = a.longitude; valB = b.longitude; break;
      case 'Posted By': valA = (a.username || a.userEmail).toLowerCase(); valB = (b.username || b.userEmail).toLowerCase(); break;
      case 'Timestamp (ET)': valA = new Date(a.createdAt); valB = new Date(b.createdAt); break;
    }
    return sortDirection[column] ? (valA < valB ? -1 : 1) : (valA < valB ? 1 : -1);
  });
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
  document.getElementById('map-container').style.display = 'none';
  mediaView.style.display = 'flex';
}

function closeMediaView() {
  const mediaVideo = document.getElementById('media-video');
  mediaVideo.pause();
  mediaVideo.src = '';
  document.getElementById('media-image').src = '';
  document.getElementById('media-view').style.display = 'none';
  document.getElementById('map-container').style.display = 'block';
}

async function fetchPins() {
  try {
    const response = await fetch('https://pinmap-website.onrender.com/pins', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (response.status === 401) {
      signOut();
      return alert('Session expired. Please log in again.');
    }
    const pins = await response.json();
    const filteredPins = applyFilter(pins);
    document.getElementById('alert-counter').textContent = `Current Alerts: ${pins.length}`;

    Object.keys(markers).forEach(pinId => {
      if (!pins.some(pin => pin._id === pinId)) {
        markers[pinId].setMap(null);
        delete markers[pinId];
      }
    });

    const tableBody = document.createElement('tbody');
    const pinList = document.getElementById('pin-list');
    pinList.innerHTML = `
      <table class="pin-table">
        <thead>
          <tr>
            <th class="sortable" onclick="sortTable(pins, 'Description')">Description</th>
            <th class="sortable" onclick="sortTable(pins, 'Latitude')">Latitude</th>
            <th class="sortable" onclick="sortTable(pins, 'Longitude')">Longitude</th>
            <th class="sortable" onclick="sortTable(pins, 'Posted By')">Posted By</th>
            <th class="sortable" onclick="sortTable(pins, 'Timestamp (ET)')">Timestamp (ET)</th>
            <th>Expires</th>
            <th>Media</th>
            <th>Actions</th>
          </tr>
        </thead>
      </table>
      <div id="pagination" class="pagination-container"></div>
    `;
    pinList.querySelector('table').appendChild(tableBody);

    filteredPins.forEach(pin => {
      if (!markers[pin._id]) {
        const desc = pin.description.toLowerCase();
        const icon = desc === 'cop' || desc === 'police' ? { url: 'https://img.icons8.com/?size=100&id=fHTZqkybfaA7&format=png&color=000000', scaledSize: new google.maps.Size(32, 32) }
                  : desc === 'gun' || desc === 'shooting' || desc === 'driveby' || desc === 'shootout' ? { url: 'https://img.icons8.com/?size=100&id=10431&format=png&color=000000', scaledSize: new google.maps.Size(32, 32) }
                  : desc === 'fire' ? { url: 'https://img.icons8.com/?size=100&id=85292&format=png&color=000000', scaledSize: new google.maps.Size(32, 32) }
                  : desc === 'roadblock' ? { url: 'https://img.icons8.com/?size=100&id=8g0W0dI0kZNi&format=png&color=000000', scaledSize: new google.maps.Size(32, 32) }
                  : desc === 'wreck' || desc === 'crash' ? { url: 'https://img.icons8.com/?size=100&id=8g0W0dI0kZNi&format=png&color=000000', scaledSize: new google.maps.Size(32, 32) }
                  : 'http://maps.google.com/mapfiles/ms/icons/red-dot.png';
        markers[pin._id] = new google.maps.Marker({
          position: { lat: pin.latitude, lng: pin.longitude },
          map: map,
          title: pin.description,
          icon: icon
        });
      }

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${pin.description}</td>
        <td>${pin.latitude.toFixed(4)}</td>
        <td>${pin.longitude.toFixed(4)}</td>
        <td>
          <span onclick="viewProfile('${pin.userId._id}')" style="cursor: pointer; color: #3498db;">
            ${pin.username || pin.userEmail}
            <img src="https://img.icons8.com/small/16/visible.png" class="profile-view-icon">
          </span>
        </td>
        <td>${new Date(pin.createdAt).toLocaleString()}</td>
        <td>${new Date(pin.expiresAt).toLocaleString()}</td>
        <td>
          ${pin.media ? `
            <img src="https://img.icons8.com/small/20/image.png" class="media-view-icon" onclick="viewMedia('${pin.media}')">
          ` : 'N/A'}
        </td>
      `;

      const actionCell = document.createElement('td');
      actionCell.innerHTML = `
        <div class="action-buttons">
          <button class="standard-btn goto-btn" onclick="goToPinLocation(${pin.latitude}, ${pin.longitude})">Go To</button>
          <button class="standard-btn remove-btn" onclick="removePin('${pin._id}')">Remove</button>
          <button class="standard-btn extend-btn" onclick="extendPin('${pin._id}')">Extend</button>
          <button class="standard-btn verify-btn" onclick="verifyPin('${pin._id}')">Verify (${pin.verifications.length})</button>
          <button class="standard-btn vote-btn" onclick="voteToRemove('${pin._id}')">Vote (${pin.voteCount}/8)</button>
          <button class="standard-btn comment-btn" onclick="showComments('${pin._id}')">Comments (${pin.comments.length})</button>
        </div>
      `;
      row.appendChild(actionCell);
      tableBody.appendChild(row);
    });

    const totalPages = Math.ceil(filteredPins.length / pinsPerPage);
    currentPage = Math.min(currentPage, totalPages || 1);
    const start = (currentPage - 1) * pinsPerPage;
    const end = start + pinsPerPage;
    const paginatedPins = filteredPins.slice(start, end);

    const paginationContainer = document.getElementById('pagination');
    paginationContainer.innerHTML = `
      <button class="standard-btn prev-btn" onclick="changePage(-1)" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
      <span>Page ${currentPage} of ${totalPages || 1}</span>
      <button class="standard-btn next-btn" onclick="changePage(1)" ${currentPage === totalPages || totalPages === 0 ? 'disabled' : ''}>Next</button>
    `;
  } catch (err) {
    console.error('Fetch pins error:', err);
    alert('Error fetching pins');
  }
}

function changePage(delta) {
  currentPage += delta;
  fetchPins();
}

async function fetchWeatherAlerts() {
  try {
    const response = await fetch('https://pinmap-website.onrender.com/weather');
    const data = await response.json();
    const weatherContent = document.getElementById('weather-content');
    if (data.alerts && data.alerts.length > 0) {
      weatherContent.className = 'alert';
      weatherContent.textContent = data.alerts[0].event;
      document.getElementById('weather-link').href = data.alerts[0].link || '#';
    } else {
      weatherContent.className = '';
      weatherContent.textContent = 'No active weather alerts.';
      document.getElementById('weather-link').href = '#';
    }
  } catch (err) {
    console.error('Weather fetch error:', err);
    document.getElementById('weather-content').textContent = 'Error loading weather alerts.';
  }
}

function editProfile() {
  document.getElementById('map-container').style.display = 'none';
  document.getElementById('profile-container').style.display = 'block';
  document.getElementById('profile-view-container').style.display = 'none';
  document.getElementById('media-view').style.display = 'none';
  document.getElementById('messages-container').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'none';
  fetchProfile();
}

async function fetchProfile() {
  try {
    const response = await fetch('https://pinmap-website.onrender.com/auth/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      const profile = await response.json();
      document.getElementById('profile-picture-preview').src = profile.profilePicture || 'https://via.placeholder.com/150';
      document.getElementById('profile-picture-preview').style.display = 'block';
      document.getElementById('profile-username').value = profile.username || '';
      document.getElementById('profile-birthdate').value = profile.birthdate ? profile.birthdate.split('T')[0] : '';
      document.getElementById('profile-sex').value = profile.sex || '';
      document.getElementById('profile-location').value = profile.location || '';
    } else {
      alert('Failed to fetch profile');
    }
  } catch (err) {
    console.error('Fetch profile error:', err);
    alert('Error fetching profile');
  }
}

async function updateProfile() {
  const username = document.getElementById('profile-username').value.trim();
  const birthdate = document.getElementById('profile-birthdate').value;
  const sex = document.getElementById('profile-sex').value;
  const location = document.getElementById('profile-location').value.trim();
  const profilePicture = document.getElementById('profile-picture').files[0];

  const formData = new FormData();
  if (username) formData.append('username', username);
  if (birthdate) formData.append('birthdate', birthdate);
  if (sex) formData.append('sex', sex);
  if (location) formData.append('location', location);
  if (profilePicture) formData.append('profilePicture', profilePicture);

  try {
    const response = await fetch('https://pinmap-website.onrender.com/auth/profile', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    if (response.ok) {
      alert('Profile updated successfully');
      fetchProfileForUsername();
      showMap();
    } else {
      alert('Failed to update profile: ' + await response.text());
    }
  } catch (err) {
    console.error('Update profile error:', err);
    alert('Error updating profile');
  }
}

function closeProfile() {
  document.getElementById('profile-container').style.display = 'none';
  showMap();
}

async function viewProfile(userId) {
  currentProfileUserId = userId;
  try {
    const response = await fetch(`https://pinmap-website.onrender.com/auth/profile/${userId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      const profile = await response.json();
      document.getElementById('view-profile-picture').src = profile.profilePicture || 'https://via.placeholder.com/100';
      document.getElementById('view-profile-picture').style.display = 'block';
      document.getElementById('view-username').textContent = profile.username || profile.email;
      document.getElementById('view-location').textContent = profile.location || 'Not specified';
      document.getElementById('view-pin-count').textContent = profile.totalPins || 0;
      document.getElementById('view-reputation').textContent = profile.reputation || 0;
      document.getElementById('view-badges').textContent = profile.badges?.join(', ') || 'None';
      document.getElementById('map-container').style.display = 'none';
      document.getElementById('profile-view-container').style.display = 'block';
    } else {
      alert('Failed to fetch user profile');
    }
  } catch (err) {
    console.error('View profile error:', err);
    alert('Error viewing profile');
  }
}

async function upvoteUser() {
  try {
    const response = await fetch(`https://pinmap-website.onrender.com/auth/upvote/${currentProfileUserId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      const data = await response.json();
      document.getElementById('view-reputation').textContent = data.reputation;
      viewProfile(currentProfileUserId);
    } else {
      alert('Failed to upvote user: ' + await response.text());
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
      const data = await response.json();
      document.getElementById('view-reputation').textContent = data.reputation;
      viewProfile(currentProfileUserId);
    } else {
      alert('Failed to downvote user: ' + await response.text());
    }
  } catch (err) {
    console.error('Downvote error:', err);
    alert('Error downvoting user');
  }
}

async function sendPrivateMessage() {
  const message = document.getElementById('message-input').value.trim();
  if (!message) return alert('Message cannot be empty');

  try {
    const response = await fetch(`https://pinmap-website.onrender.com/auth/message/${currentProfileUserId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content: message })
    });
    if (response.ok) {
      alert('Message sent successfully');
      document.getElementById('message-input').value = '';
    } else {
      alert('Failed to send message: ' + await response.text());
    }
  } catch (err) {
    console.error('Send message error:', err);
    alert('Error sending message');
  }
}

async function showMessages(tab = 'inbox') {
  try {
    const endpoint = tab === 'inbox' ? '/auth/messages/inbox' : '/auth/messages/outbox';
    const response = await fetch(`https://pinmap-website.onrender.com${endpoint}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      const messages = await response.json();
      document.getElementById('map-container').style.display = 'none';
      document.getElementById('messages-container').style.display = 'block';
      const messagesList = document.getElementById('messages-list');
      messagesList.innerHTML = `
        <div class="message-tabs">
          <button class="${tab === 'inbox' ? 'active' : ''}" onclick="showMessages('inbox')">Inbox (${messages.filter(m => tab === 'inbox' && !m.read).length})</button>
          <button class="${tab === 'outbox' ? 'active' : ''}" onclick="showMessages('outbox')">Outbox</button>
        </div>
        ${messages.map((message, index) => `
          <div class="message ${tab === 'inbox' && !message.read ? 'unread' : ''}">
            <div class="message-header">
              <span class="message-sender">${tab === 'inbox' ? (message.senderId.username || message.senderId.email) : 'To: ' + (message.recipientId.username || message.recipientId.email)}</span>
              <span class="message-timestamp">${new Date(message.timestamp).toLocaleString()}</span>
            </div>
            <p class="message-content">${message.content}</p>
            <div class="message-actions">
              ${tab === 'inbox' && !message.read ? `<button class="standard-btn" onclick="markMessageAsRead('${message._id}')">Mark as Read</button>` : ''}
              ${tab === 'inbox' ? `<button class="standard-btn reply-btn" onclick="showReplyForm('${message._id}', ${index})">Reply</button>` : ''}
              <button class="standard-btn delete-btn" onclick="deleteMessage('${message._id}', '${tab}')">Delete</button>
              <button class="standard-btn forward-btn" onclick="showForwardForm('${message._id}', ${index})">Forward</button>
            </div>
            <div id="reply-form-${index}" class="reply-form"></div>
            <div id="forward-form-${index}" class="forward-form"></div>
          </div>
        `).join('')}
      `;
      checkNewMessages();
    } else {
      alert('Failed to fetch messages');
    }
  } catch (err) {
    console.error('Fetch messages error:', err);
    alert('Error fetching messages');
  }
}

async function markMessageAsRead(messageId) {
  try {
    const response = await fetch(`https://pinmap-website.onrender.com/auth/message/${messageId}/read`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      showMessages('inbox');
    } else {
      alert('Failed to mark message as read');
    }
  } catch (err) {
    console.error('Mark message read error:', err);
    alert('Error marking message as read');
  }
}

function showReplyForm(messageId, index) {
  const replyForm = document.getElementById(`reply-form-${index}`);
  replyForm.innerHTML = `
    <textarea id="reply-content-${index}" placeholder="Type your reply..."></textarea>
    <button class="standard-btn" onclick="sendReply('${messageId}', ${index})">Send Reply</button>
  `;
}

async function sendReply(messageId, index) {
  const content = document.getElementById(`reply-content-${index}`).value.trim();
  if (!content) return alert('Reply cannot be empty');
  try {
    const response = await fetch(`https://pinmap-website.onrender.com/auth/message/${messageId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content })
    });
    if (response.ok) {
      alert('Reply sent successfully');
      showMessages('inbox');
    } else {
      alert('Failed to send reply: ' + await response.text());
    }
  } catch (err) {
    console.error('Send reply error:', err);
    alert('Error sending reply');
  }
}

function showForwardForm(messageId, index) {
  const forwardForm = document.getElementById(`forward-form-${index}`);
  forwardForm.innerHTML = `
    <input type="text" id="forward-recipient-${index}" placeholder="Enter recipient email or username">
    <button class="standard-btn" onclick="forwardMessage('${messageId}', ${index})">Forward</button>
  `;
}

async function forwardMessage(messageId, index) {
  const recipient = document.getElementById(`forward-recipient-${index}`).value.trim();
  if (!recipient) return alert('Recipient cannot be empty');
  try {
    const response = await fetch(`https://pinmap-website.onrender.com/auth/message/forward/${messageId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ recipient })
    });
    if (response.ok) {
      alert('Message forwarded successfully');
      showMessages('outbox');
    } else {
      alert('Failed to forward message: ' + await response.text());
    }
  } catch (err) {
    console.error('Forward message error:', err);
    alert('Error forwarding message');
  }
}

async function deleteMessage(messageId, tab) {
  if (!confirm('Are you sure you want to delete this message?')) return;
  try {
    const response = await fetch(`https://pinmap-website.onrender.com/auth/message/${messageId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      showMessages(tab);
    } else {
      alert('Failed to delete message');
    }
  } catch (err) {
    console.error('Delete message error:', err);
    alert('Error deleting message');
  }
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
      messagesBtn.textContent = `Messages${unreadCount ? ` (${unreadCount})` : ''}`;
      messagesBtn.style.color = '#ffffff';
      messagesBtn.style.backgroundColor = unreadCount ? '#e74c3c' : '#3498db';
    }
  } catch (err) {
    console.error('Check new messages error:', err);
  }
}

function showAdminPanel() {
  document.getElementById('map-container').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'block';
  fetchAdminData();
}

async function fetchAdminData() {
  try {
    const [pinsResponse, usersResponse, analyticsResponse] = await Promise.all([
      fetch('https://pinmap-website.onrender.com/pins', { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch('https://pinmap-website.onrender.com/auth/users', { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch('https://pinmap-website.onrender.com/admin/analytics', { headers: { 'Authorization': `Bearer ${token}` } })
    ]);

    if (pinsResponse.status === 401 || usersResponse.status === 401 || analyticsResponse.status === 401) {
      signOut();
      return alert('Session expired. Please log in again.');
    }

    const pins = await pinsResponse.json();
    const users = await usersResponse.json();
    const analytics = await analyticsResponse.json();

    const adminPanel = document.getElementById('admin-panel');
    adminPanel.innerHTML = `
      <div class="admin-container">
        <h2>Admin Panel</h2>
        <button class="standard-btn" onclick="showMap()">Back to Map</button>
        <div class="analytics">
          <h3>Analytics</h3>
          <p>Total Alerts: ${analytics.totalPins}</p>
          <p>Active Users: ${analytics.activeUsers}</p>
          <h4>Alert Types:</h4>
          <ul>${analytics.pinTypes.map(pt => `<li>${pt.type}: ${pt.count}</li>`).join('')}</ul>
          <h4>Top Contributors:</h4>
          <ul>${analytics.topUsers.map(user => `<li>${user.username || user.email}: ${user.totalPins || 0} pins</li>`).join('')}</ul>
        </div>
        <h3>Manage Alerts</h3>
        <table class="pin-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Posted By</th>
              <th>Timestamp (ET)</th>
              <th>Expires</th>
              <th>Media</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="admin-pin-list"></tbody>
        </table>
      </div>
    `;
    const adminPinList = document.getElementById('admin-pin-list');
    adminPinList.innerHTML = pins.map(pin => `
      <tr>
        <td>${pin.description}</td>
        <td>${pin.latitude.toFixed(4)}</td>
        <td>${pin.longitude.toFixed(4)}</td>
        <td>${pin.username || pin.userEmail}</td>
        <td>${new Date(pin.createdAt).toLocaleString()}</td>
        <td>${new Date(pin.expiresAt).toLocaleString()}</td>
        <td>${pin.media ? `<img src="https://img.icons8.com/small/20/image.png" class="media-view-icon" onclick="viewMedia('${pin.media}')">` : 'N/A'}</td>
        <td>
          <button class="standard-btn remove-btn" onclick="removePin('${pin._id}')">Remove</button>
          <button class="standard-btn extend-btn" onclick="extendPin('${pin._id}')">Extend</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Fetch admin data error:', err);
    alert('Error fetching admin data');
  }
}