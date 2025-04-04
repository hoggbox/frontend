let token;
let currentLatLng;
let userId;
let isAdmin = false;
let geocoder;
let markers = {};
let userLocationMarker;
let userPath = [];
let userPolyline = null;
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
let map;
let trackingPaused = false;
let directionsService;
let directionsRenderer;

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

async function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeToPush() {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: await urlBase64ToUint8Array('BIEBvt54qcb86fNJ9akRzuzzgvgY5Vi0hzvqSflNatlzIjVR6Clz02wY0by5vANRrLljbJoLR1uyRroK3Up21NM')
      });
      await fetch('https://pinmap-website.onrender.com/subscribe', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(subscription),
      });
      console.log('Push subscription successful');
    } catch (err) {
      console.error('Push subscription error:', err);
    }
  }
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
  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map: map,
    suppressMarkers: true,
    polylineOptions: { strokeColor: '#1E90FF', strokeWeight: 5 }
  });

  // Add Traffic Layer
  const trafficLayer = new google.maps.TrafficLayer();
  trafficLayer.setMap(map);

  token = localStorage.getItem('token');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      userId = payload.id;
      isAdmin = payload.email === 'imhoggbox@gmail.com';
      console.log('Logged in as:', payload.email, 'Admin:', isAdmin);
      fetchProfileForUsername();
      showMap();
      startMap();
      fetchWeatherAlerts();
      setupWebSocket();
      checkNewMessages();
      subscribeToPush();
      document.getElementById('admin-btn').style.display = isAdmin ? 'inline-block' : 'none';
      const bizOption = document.querySelector('#pin-type option[value="business"]');
      if (bizOption) bizOption.style.display = isAdmin ? 'block' : 'none';
    } catch (err) {
      console.error('Invalid token:', err);
      signOut();
    }
  } else {
    showLogin();
  }

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
    if (data.type === 'location' && data.userId === userId) {
      updateUserLocation(data.latitude, data.longitude);
    } else if (data.type === 'allLocations' && isAdmin) {
      console.log('Admin received allLocations:', data.locations);
      data.locations.forEach(({ userId: uid, email, latitude, longitude }) => {
        if (uid !== userId) {
          const pos = { lat: latitude, lng: longitude };
          if (!markers[uid]) {
            markers[uid] = {
              marker: new google.maps.Marker({
                position: pos,
                map: map,
                title: email,
                icon: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png'
              }),
              path: [pos],
              polyline: new google.maps.Polyline({
                path: [pos],
                geodesic: true,
                strokeColor: '#FF0000',
                strokeOpacity: 0.8,
                strokeWeight: 2,
                map: map
              })
            };
          } else {
            markers[uid].path.push(pos);
            const oldPos = markers[uid].marker.getPosition();
            const steps = 20;
            const latStep = (pos.lat - oldPos.lat()) / steps;
            const lngStep = (pos.lng - oldPos.lng()) / steps;
            let step = 0;

            function animate() {
              if (step <= steps) {
                const nextLat = oldPos.lat() + latStep * step;
                const nextLng = oldPos.lng() + lngStep * step;
                markers[uid].marker.setPosition({ lat: nextLat, lng: nextLng });
                step++;
                requestAnimationFrame(animate);
              }
            }
            animate();
            markers[uid].polyline.setPath(markers[uid].path);
          }
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
    alert('WebSocket connection lost. Please refresh the page.');
  };
  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
    alert('WebSocket error occurred. Check your connection.');
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
        console.log('Initial position:', userLocation);
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
  if (navigator.geolocation && !trackingPaused) {
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        console.log('New position:', position.coords.latitude, position.coords.longitude);
        const userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
        updateUserLocation(userLocation.lat, userLocation.lng);
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

        // Recalculate route if navigation is active
        if (directionsRenderer.getDirections()) {
          const destination = directionsRenderer.getDirections().routes[0].legs[0].end_location;
          calculateRoute(destination);
        }
      },
      (error) => {
        console.error('Tracking error:', error);
        if (error.code === error.PERMISSION_DENIED && userLocationMarker) {
          userLocationMarker.setMap(null);
          userLocationMarker = null;
          if (userPolyline) {
            userPolyline.setMap(null);
            userPolyline = null;
          }
          userPath = [];
          map.setCenter({ lat: 33.0801, lng: -83.2321 });
        }
      },
      { enableHighAccuracy: true, timeout: 1000, maximumAge: 0 }
    );
  }
}

function toggleTracking() {
  trackingPaused = !trackingPaused;
  const btn = document.getElementById('toggle-tracking-btn');
  btn.textContent = `Tracking: ${trackingPaused ? 'Off' : 'On'}`;
  btn.classList.toggle('paused', trackingPaused);
  if (trackingPaused && watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = undefined;
  } else if (!trackingPaused) {
    startLocationTracking();
  }
}

function updateUserLocation(lat, lng) {
  const newPos = { lat, lng };
  userPath.push(newPos);

  if (!userLocationMarker) {
    userLocationMarker = new google.maps.Marker({
      position: newPos,
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
    userPolyline = new google.maps.Polyline({
      path: userPath,
      geodesic: true,
      strokeColor: '#0000FF',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      map: map
    });
    console.log('Marker created at:', newPos);
  } else {
    const oldPos = userLocationMarker.getPosition();
    const steps = 20;
    const latStep = (newPos.lat - oldPos.lat()) / steps;
    const lngStep = (newPos.lng - oldPos.lng()) / steps;
    let step = 0;

    function animate() {
      if (step <= steps) {
        const nextLat = oldPos.lat() + latStep * step;
        const nextLng = oldPos.lng() + lngStep * step;
        userLocationMarker.setPosition({ lat: nextLat, lng: nextLng });
        step++;
        requestAnimationFrame(animate);
      }
    }
    animate();
    userPolyline.setPath(userPath);
    console.log('Marker moved to:', newPos);
  }
  if (!isAdmin) map.panTo(newPos);
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

async function calculateRoute(destination) {
  if (!userLocationMarker) {
    alert('Waiting for your location...');
    return;
  }

  const origin = userLocationMarker.getPosition();
  const request = {
    origin: origin,
    destination: destination,
    travelMode: google.maps.TravelMode.DRIVING,
    provideRouteAlternatives: true,
    drivingOptions: {
      departureTime: new Date(),
      trafficModel: 'bestguess'
    }
  };

  directionsService.route(request, async (result, status) => {
    if (status === google.maps.DirectionsStatus.OK) {
      directionsRenderer.setDirections(result);
      const route = result.routes[0];
      const leg = route.legs[0];
      const duration = leg.duration_in_traffic || leg.duration;
      const normalDuration = leg.duration.value;
      const trafficDuration = leg.duration_in_traffic ? leg.duration_in_traffic.value : normalDuration;

      // Check for traffic delays
      if (trafficDuration > normalDuration * 1.2) { // 20% longer than normal
        alert(`Traffic delay detected! Estimated travel time: ${duration.text}`);
      }

      // Check for user-reported pins along the route
      const pinResponse = await fetch('https://pinmap-website.onrender.com/pins', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const pins = await pinResponse.json();
      const routePath = route.overview_path;
      const alerts = pins.filter(pin => {
        if (pin.pinType !== 'alert') return false;
        const pinPos = new google.maps.LatLng(pin.latitude, pin.longitude);
        return routePath.some(point => google.maps.geometry.spherical.computeDistanceBetween(point, pinPos) < 500); // Within 500 meters
      });

      if (alerts.length > 0) {
        const alertMessages = alerts.map(pin => pin.description).join(', ');
        alert(`Alerts on your route: ${alertMessages}`);
      }
    } else {
      console.error('Directions request failed:', status);
      alert('Failed to calculate route: ' + status);
    }
  });
}

function startNavigation() {
  const destination = document.getElementById('address-search').value;
  if (!destination) {
    alert('Please enter a destination');
    return;
  }
  geocoder.geocode({ address: destination }, (results, status) => {
    if (status === 'OK') {
      const location = results[0].geometry.location;
      calculateRoute(location);
    } else {
      alert('Destination not found: ' + status);
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
    const response = await fetch('https://pinmap-website.onrender.com/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, stayLoggedIn }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      alert(`Login failed: ${errorData.message || 'Invalid credentials'}`);
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
  if (userPolyline) {
    userPolyline.setMap(null);
    userPolyline = null;
  }
  userPath = [];
  if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
  watchId = undefined;
  if (ws) ws.close();
  Object.values(markers).forEach(user => {
    user.marker.setMap(null);
    user.polyline.setMap(null);
  });
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
  try {
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
      const closestPin = pins.find(pin => getDistance(currentLatLng.lat, currentLatLng.lng, pin.latitude, pin.longitude) < 304.8);
      alert(`Alert too close to existing pin at (${closestPin.latitude.toFixed(4)}, ${closestPin.longitude.toFixed(4)})`);
      currentLatLng = null;
      return;
    }

    const pinType = document.getElementById('pin-type').value;
    const descriptionInput = document.getElementById('description').value.trim();
    const description = descriptionInput || pinType;
    const mediaFile = document.getElementById('media-upload').files[0];
    const formData = new FormData();
    formData.append('latitude', currentLatLng.lat);
    formData.append('longitude', currentLatLng.lng);
    formData.append('description', description);
    formData.append('pinType', pinType);
    if (mediaFile) formData.append('media', mediaFile);

    const postResponse = await fetch('https://pinmap-website.onrender.com/pins', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });

    if (postResponse.ok) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'newPin', pin: { latitude: currentLatLng.lat, longitude: currentLatLng.lng, description } }));
      }
      fetchPins();
      document.getElementById('pin-type').value = '';
      document.getElementById('description').value = '';
      document.getElementById('media-upload').value = '';
      currentLatLng = null;
    } else {
      const errorData = await postResponse.json();
      alert(`Failed to add alert: ${errorData.message || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('Add pin error:', err);
    alert('Error adding alert. Check your media file (max 5MB, image only) and try again.');
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
    } else {
      alert(result.message || 'Failed to vote');
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
  console.log('fetchPins() started');
  try {
    // Fetch user pins
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

    // Fetch traffic cameras (handle errors gracefully)
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

    // Format traffic cameras to match pin structure
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

    // Combine user pins with traffic cameras
    pins = [...pins, ...formattedCameras];

    const filteredPins = applyFilter(pins.filter(pin => pin.pinType !== 'traffic-camera')); // Exclude traffic cams from table
    document.getElementById('alert-counter').textContent = `Current Alerts: ${pins.filter(pin => pin.pinType === 'alert').length}`;

    Object.keys(markers).forEach(pinId => {
      if (!pins.some(pin => pin._id === pinId) && !markers[pinId].path) {
        markers[pinId].setMap(null);
        delete markers[pinId];
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
            <th class="sortable" onclick="fetchPins().then(() => sortTable(pins, 'Description'))">Description</th>
            <th class="sortable" onclick="fetchPins().then(() => sortTable(pins, 'Latitude'))">Latitude</th>
            <th class="sortable" onclick="fetchPins().then(() => sortTable(pins, 'Longitude'))">Longitude</th>
            <th class="sortable" onclick="fetchPins().then(() => sortTable(pins, 'Posted By'))">Posted By</th>
            <th class="sortable" onclick="fetchPins().then(() => sortTable(pins, 'Timestamp (ET)'))">Timestamp (ET)</th>
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
      if (!markers[pin._id]) {
        let icon;
        if (pin.pinType === 'traffic-camera') {
          icon = { url: 'https://img.icons8.com/?size=100&id=10208&format=png&color=000000', scaledSize: new google.maps.Size(32, 32) };
          markers[pin._id] = new google.maps.Marker({
            position: { lat: pin.latitude, lng: pin.longitude },
            map: map,
            title: pin.description,
            icon: icon
          });
          markers[pin._id].addListener('click', () => {
            const infoWindow = new google.maps.InfoWindow({
              content: `
                <div>
                  <h3>${pin.description}</h3>
                  <img src="${pin.imageUrl}" alt="Traffic Camera Image" style="width: 320px; height: 240px;" />
                </div>
              `
            });
            infoWindow.open(map, markers[pin._id]);
          });
        } else if (pin.description.toLowerCase().includes('cop') || pin.description.toLowerCase().includes('police')) {
          icon = { url: 'https://img.icons8.com/?size=100&id=fHTZqkybfaA7&format=png&color=000000', scaledSize: new google.maps.Size(32, 32) };
          markers[pin._id] = new google.maps.Marker({
            position: { lat: pin.latitude, lng: pin.longitude },
            map: map,
            title: pin.description,
            icon: icon
          });
        } else if (pin.pinType === 'business') {
          icon = { url: 'https://img.icons8.com/?size=100&id=8312&format=png&color=FFD700', scaledSize: new google.maps.Size(32, 32) };
          markers[pin._id] = new google.maps.Marker({
            position: { lat: pin.latitude, lng: pin.longitude },
            map: map,
            title: pin.description,
            icon: icon
          });
        } else {
          markers[pin._id] = new google.maps.Marker({
            position: { lat: pin.latitude, lng: pin.longitude },
            map: map,
            title: pin.description,
            icon: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png'
          });
        }
      }

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
      const preview = document.getElementById('profile-picture-preview');
      preview.src = profile.profilePicture ? 
        `https://pinmap-website.onrender.com${profile.profilePicture}` : 'https://via.placeholder.com/150';
      preview.style.display = 'block';
      document.getElementById('profile-username').value = profile.username || '';
      document.getElementById('profile-birthdate').value = profile.birthdate ? profile.birthdate.split('T')[0] : '';
      document.getElementById('profile-sex').value = profile.sex || '';
      document.getElementById('profile-location').value = profile.location || '';
    } else {
      const errorData = await response.json();
      alert(`Failed to fetch profile: ${errorData.message || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('Fetch profile error:', err);
    alert('Error fetching profile');
  }
}

async function updateProfile() {
  const formData = new FormData();
  const profilePicture = document.getElementById('profile-picture').files[0];
  if (profilePicture) formData.append('profilePicture', profilePicture);
  formData.append('username', document.getElementById('profile-username').value);
  formData.append('birthdate', document.getElementById('profile-birthdate').value);
  formData.append('sex', document.getElementById('profile-sex').value);
  formData.append('location', document.getElementById('profile-location').value);

  try {
    const response = await fetch('https://pinmap-website.onrender.com/auth/profile', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    if (response.ok) {
      fetchProfileForUsername();
      fetchProfile();
      showMap();
    } else {
      const errorData = await response.json();
      alert(errorData.message || 'Failed to update profile');
    }
  } catch (err) {
    console.error('Update profile error:', err);
    alert('Error updating profile');
  }
}

function closeProfile() {
  showMap();
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
      document.getElementById('map-container').style.display = 'none';
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
  document.getElementById('map-container').style.display = 'block';
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
  try {
    const endpoint = type === 'inbox' ? 'inbox' : 'outbox';
    const response = await fetch(`https://pinmap-website.onrender.com/auth/messages/${endpoint}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      const messages = await response.json();
      const messagesList = document.getElementById('messages-list');
      messagesList.innerHTML = '';
      messages.forEach(msg => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${msg.read ? '' : 'unread'}`;
        const sender = type === 'inbox' ? (msg.senderId.username || msg.senderId.email) : 'You';
        const recipient = type === 'outbox' ? (msg.recipientId.username || msg.recipientId.email) : 'You';
        msgDiv.innerHTML = `
          <p><strong>${sender}</strong> to <strong>${recipient}</strong> (${new Date(msg.timestamp).toLocaleString()}):</p>
          <p>${msg.content}</p>
          <div class="message-controls">
            ${type === 'inbox' ? `
              <button class="standard-btn reply-btn" onclick="replyToMessage('${msg.senderId._id}', '${msg.content}')">Reply</button>
              <button class="standard-btn delete-btn" onclick="deleteMessage('${msg._id}')">Delete</button>
            ` : ''}
          </div>
        `;
        messagesList.appendChild(msgDiv);
      });
      document.getElementById('map-container').style.display = 'none';
      document.getElementById('messages-container').style.display = 'block';
      document.getElementById('inbox-btn').classList.toggle('active', type === 'inbox');
      document.getElementById('outbox-btn').classList.toggle('active', type === 'outbox');
    } else {
      const errorData = await response.json();
      alert(`Failed to fetch ${type}: ${errorData.message || 'Unknown error'}`);
    }
  } catch (err) {
    console.error(`Fetch ${type} error:`, err);
    alert(`Error fetching ${type}`);
  }
}

async function replyToMessage(recipientId, originalMessage) {
  const reply = prompt('Enter your reply:', `Re: ${originalMessage.slice(0, 20)}...`);
  if (!reply) return;
  try {
    const response = await fetch(`https://pinmap-website.onrender.com/auth/message/${recipientId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: reply })
    });
    if (response.ok) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'privateMessage', senderId: userId, recipientId, content: reply }));
      }
      alert('Reply sent');
      fetchMessages('inbox');
    } else {
      const errorData = await response.json();
      alert(`Failed to send reply: ${errorData.message || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('Reply error:', err);
    alert('Error sending reply');
  }
}

async function deleteMessage(messageId) {
  if (!confirm('Are you sure you want to delete this message?')) return;
  try {
    const response = await fetch(`https://pinmap-website.onrender.com/auth/messages/${messageId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      fetchMessages('inbox');
    } else {
      const errorData = await response.json();
      alert(`Failed to delete message: ${errorData.message || 'Unknown error'}`);
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
      if (messagesBtn) {
        messagesBtn.textContent = `Messages${unreadCount > 0 ? ` (${unreadCount})` : ''}`;
        messagesBtn.setAttribute('data-unread', unreadCount);
      }
    }
  } catch (err) {
    console.error('Check messages error:', err);
  }
}

function showAdminPanel() {
  window.location.href = 'admin.html';
}

document.addEventListener('DOMContentLoaded', () => {
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', login);
  }
  fetchPins();
});
