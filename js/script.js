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
let ws;
let username;
let map;
let trackingPaused = false;
let directionsService;
let directionsRenderer;
let isMobile = false;
let lastSpeed = 0;
let speedLimit = 'N/A';
let voiceNavigationEnabled = true;
let currentDestination = null;
let currentRoute = null;
let lastSpokenInstruction = null;
let recognition;
let isRecording = false;
const notifiedPins = new Set(); // Track notified pins to prevent duplicates

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

function speak(text) {
  if ('speechSynthesis' in window && voiceNavigationEnabled) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.volume = 1;
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }
}

function speakNextInstruction() {
  if (!voiceNavigationEnabled || !currentRoute || !userLocationMarker) return;

  const steps = currentRoute.routes[0].legs[0].steps;
  const userPos = userLocationMarker.getPosition();
  let closestStep = null;
  let closestDistance = Infinity;

  steps.forEach((step) => {
    const stepPos = step.start_location;
    const distance = google.maps.geometry.spherical.computeDistanceBetween(userPos, stepPos);
    if (distance < closestDistance && distance < 500) {
      closestDistance = distance;
      closestStep = step;
    }
  });

  if (closestStep && closestStep.instructions !== lastSpokenInstruction) {
    const instruction = closestStep.instructions.replace(/<[^>]+>/g, '');
    speak(`${instruction} in ${Math.round(closestDistance)} meters`);
    lastSpokenInstruction = closestStep.instructions;
  }

  setTimeout(speakNextInstruction, 10000);
}

function toggleVoiceRecognition() {
  if (!('webkitSpeechRecognition' in window)) {
    alert('Speech recognition not supported in this browser.');
    return;
  }

  if (!recognition) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = async (event) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      console.log('Voice command:', transcript);
      let description = '';
      if (transcript.includes('drop a cop alert') || transcript.includes('add cop alert')) {
        description = 'Cop';
      } else if (transcript.includes('drop a wreck alert') || transcript.includes('add wreck alert')) {
        description = 'Wreck/Crash';
      } else if (transcript.includes('drop a shooting alert') || transcript.includes('add shooting alert')) {
        description = 'Shooting';
      } else if (transcript.includes('drop a fire alert') || transcript.includes('add fire alert')) {
        description = 'Fire';
      } else if (transcript.includes('drop a roadblock alert') || transcript.includes('add roadblock alert')) {
        description = 'Roadblock';
      } else {
        alert('Unrecognized command. Say "Drop a cop alert" or similar.');
        return;
      }
      await addVoiceAlert(description);
      stopVoiceRecognition();
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      stopVoiceRecognition();
    };

    recognition.onend = () => {
      stopVoiceRecognition();
    };
  }

  if (isRecording) {
    stopVoiceRecognition();
  } else {
    isRecording = true;
    document.querySelector('.mic-btn').classList.add('active');
    recognition.start();
  }
}

function stopVoiceRecognition() {
  if (recognition && isRecording) {
    recognition.stop();
    isRecording = false;
    document.querySelector('.mic-btn').classList.remove('active');
  }
}

async function addVoiceAlert(description) {
  if (!userLocationMarker) {
    alert('Waiting for your location...');
    return;
  }

  const position = userLocationMarker.getPosition();
  const latitude = position.lat();
  const longitude = position.lng();

  try {
    const response = await fetch('https://pinmap-website.onrender.com/pins', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        latitude,
        longitude,
        description,
        pinType: 'alert'
      })
    });

    if (response.ok) {
      const pin = await response.json();
      if (ws.readyState === WebSocket.OPEN && !notifiedPins.has(pin._id)) {
        ws.send(JSON.stringify({
          type: 'voiceAlert',
          userId,
          description,
          latitude,
          longitude,
          _id: pin._id
        }));
        notifiedPins.add(pin._id);
      }
      speak('Alert added successfully');
      fetchPins();
    } else {
      const errorData = await response.json();
      alert(`Failed to add alert: ${errorData.message}`);
    }
  } catch (err) {
    console.error('Voice alert error:', err);
    alert('Error adding voice alert');
  }
}

function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    zoom: 12,
    styles: [
      {
        "featureType": "all",
        "elementType": "geometry.fill",
        "stylers": [
          { "color": "#ffffff" }
        ]
      },
      {
        "featureType": "road",
        "elementType": "geometry.stroke",
        "stylers": [
          { "color": "#d3d3d3" }
        ]
      },
      {
        "featureType": "road.highway",
        "elementType": "geometry.fill",
        "stylers": [
          { "color": "#00adef" }
        ]
      },
      {
        "featureType": "road.arterial",
        "elementType": "geometry.fill",
        "stylers": [
          { "color": "#e0e0e0" }
        ]
      },
      {
        "featureType": "water",
        "elementType": "geometry.fill",
        "stylers": [
          { "color": "#b9d3c2" }
        ]
      },
      {
        "featureType": "poi",
        "elementType": "geometry.fill",
        "stylers": [
          { "color": "#f0f0f0" }
        ]
      },
      {
        "featureType": "all",
        "elementType": "labels.text.fill",
        "stylers": [
          { "color": "#333333" }
        ]
      },
      {
        "featureType": "all",
        "elementType": "labels.text.stroke",
        "stylers": [
          { "color": "#ffffff" },
          { "weight": 2 }
        ]
      }
    ]
  });
  geocoder = new google.maps.Geocoder();
  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map: map,
    suppressMarkers: true,
    polylineOptions: { strokeColor: '#00adef', strokeWeight: 6 }
  });

  const trafficLayer = new google.maps.TrafficLayer();
  trafficLayer.setMap(map);

  isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  token = localStorage.getItem('token');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      userId = payload.id;
      isAdmin = payload.email === 'imhoggbox@gmail.com';
      fetchProfileForUsername();
      showMap();
      startMap();
      setupWebSocket();
      subscribeToPush();

      const menuBtn = document.getElementById('menu-btn');
      const menuDropdown = document.getElementById('menu-dropdown');
      if (menuBtn && menuDropdown) {
        menuBtn.addEventListener('click', () => {
          menuDropdown.classList.toggle('show');
        });
      }

      const hud = document.createElement('div');
      hud.className = 'gps-hud';
      hud.innerHTML = `
        <p class="speed">Speed: 0 mph</p>
        <p class="destination">Destination: Not set</p>
        <p class="eta">ETA: --</p>
        <p class="distance">Distance: --</p>
      `;
      document.getElementById('map-container').appendChild(hud);

      const alertsBtn = document.createElement('div');
      alertsBtn.className = 'alerts-btn';
      alertsBtn.innerHTML = '🚨';
      alertsBtn.addEventListener('click', showAlertsPage);
      document.body.appendChild(alertsBtn);

      const plusBtn = document.createElement('div');
      plusBtn.className = 'plus-btn';
      plusBtn.innerHTML = '+';
      plusBtn.addEventListener('click', showAddAlertPage);
      document.body.appendChild(plusBtn);

      const micBtn = document.createElement('div');
      micBtn.className = 'mic-btn';
      micBtn.innerHTML = '🎙️';
      micBtn.addEventListener('click', toggleVoiceRecognition);
      document.body.appendChild(micBtn);
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
}

function showMap() {
  document.getElementById('auth').style.display = 'none';
  document.getElementById('map-container').style.display = 'block';
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
    if (data.type === 'location' && data.userId === userId) {
      updateUserLocation(data.latitude, data.longitude);
    } else if (data.type === 'newPin' && !notifiedPins.has(data.pin._id)) {
      notifiedPins.add(data.pin._id);
      fetchPins();
      if (voiceNavigationEnabled) {
        speak(`New alert: ${data.pin.description}`);
      }
    } else if (data.type === 'newComment') {
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

function updateUserLocation(lat, lng, speed = 0) {
  const newPos = { lat, lng };
  userPath.push(newPos);

  lastSpeed = speed ? (speed * 2.23694).toFixed(1) : lastSpeed;

  const hud = document.querySelector('.gps-hud');
  if (hud) {
    hud.querySelector('.speed').textContent = `Speed: ${lastSpeed} mph`;
    hud.querySelector('.destination').textContent = `Destination: ${currentDestination || 'Not set'}`;
    hud.querySelector('.eta').textContent = `ETA: ${currentRoute ? currentRoute.routes[0].legs[0].duration.text : '--'}`;
    hud.querySelector('.distance').textContent = `Distance: ${currentRoute ? currentRoute.routes[0].legs[0].distance.text : '--'}`;
  }

  if (!userLocationMarker) {
    userLocationMarker = new google.maps.Marker({
      position: newPos,
      map: map,
      title: 'Your Location',
      icon: {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 6,
        fillColor: '#00adef',
        fillOpacity: 1,
        strokeWeight: 2,
        strokeColor: '#fff'
      }
    });
    userPolyline = new google.maps.Polyline({
      path: userPath,
      geodesic: true,
      strokeColor: '#00adef',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      map: map
    });
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
  }
  map.panTo(newPos);

  fetch('https://pinmap-website.onrender.com/auth/location', {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude: lat, longitude: lng })
  }).catch(err => console.error('Error updating location:', err));
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
}

function startLocationTracking() {
  if (navigator.geolocation && !trackingPaused) {
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
        updateUserLocation(userLocation.lat, userLocation.lng, position.coords.speed);
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
      },
      (error) => {
        console.error('Tracking error:', error);
      },
      { enableHighAccuracy: true, timeout: 1000, maximumAge: 0 }
    );
  }
}

async function searchAddress() {
  const address = document.getElementById('address-search').value;
  if (!address) return alert('Please enter an address');
  geocoder.geocode({ address }, (results, status) => {
    if (status === 'OK') {
      const location = results[0].geometry.location;
      map.setCenter(location);
      map.setZoom(15);
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
      currentRoute = result;
      currentDestination = document.getElementById('address-search').value;
      updateUserLocation(origin.lat(), origin.lng(), lastSpeed);

      if (voiceNavigationEnabled) {
        speak('Route calculated. Starting navigation.');
        speakNextInstruction();
      }

      const route = result.routes[0];
      const pinResponse = await fetch('https://pinmap-website.onrender.com/pins', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const pins = await pinResponse.json();
      const routePath = route.overview_path;
      const alerts = pins.filter(pin => {
        if (pin.pinType !== 'alert') return false;
        const pinPos = new google.maps.LatLng(pin.latitude, pin.longitude);
        return routePath.some(point => google.maps.geometry.spherical.computeDistanceBetween(point, pinPos) < 500);
      });

      if (alerts.length > 0 && voiceNavigationEnabled) {
        const alertMessages = alerts.map(pin => pin.description).join(', ');
        speak(`Alerts on your route: ${alertMessages}`);
      }
    } else {
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
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  const stayLoggedIn = document.getElementById('stay-logged-in').checked;

  if (!email || !password) {
    alert('Please enter both email and password');
    return;
  }

  try {
    const response = await fetch('https://pinmap-website.onrender.com/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, stayLoggedIn })
    });

    if (response.ok) {
      const data = await response.json();
      token = data.token;
      localStorage.setItem('token', token);
      const payload = JSON.parse(atob(token.split('.')[1]));
      userId = payload.id;
      isAdmin = payload.email === 'imhoggbox@gmail.com';
      fetchProfileForUsername();
      showMap();
      startMap();
      setupWebSocket();
      subscribeToPush();
    } else {
      const errorData = await response.json();
      alert(`Login failed: ${errorData.message}`);
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
  Object.values(markers).forEach(marker => marker.setMap(null));
  markers = {};
  notifiedPins.clear();
  showLogin();
}
async function addPin() {
  if (!userLocationMarker) {
    alert('Waiting for your location...');
    return;
  }

  const position = userLocationMarker.getPosition();
  const latitude = position.lat();
  const longitude = position.lng();
  const pinType = document.getElementById('pin-type').value;
  const description = document.getElementById('description').value.trim() || pinType;
  const mediaFile = document.getElementById('media-upload').files[0];

  try {
    const pins = await fetch('https://pinmap-website.onrender.com/pins', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(res => res.json());
    const tooClose = pins.some(pin => getDistance(latitude, longitude, pin.latitude, pin.longitude) < 304.8);
    if (tooClose) {
      const closestPin = pins.find(pin => getDistance(latitude, longitude, pin.latitude, pin.longitude) < 304.8);
      alert(`Alert too close to existing pin at (${closestPin.latitude.toFixed(4)}, ${closestPin.longitude.toFixed(4)})`);
      return;
    }

    const formData = new FormData();
    formData.append('latitude', latitude);
    formData.append('longitude', longitude);
    formData.append('description', description);
    formData.append('pinType', pinType || 'alert');
    if (mediaFile) formData.append('media', mediaFile);

    const response = await fetch('https://pinmap-website.onrender.com/pins', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    if (response.ok) {
      const pin = await response.json();
      if (ws.readyState === WebSocket.OPEN && !notifiedPins.has(pin._id)) {
        ws.send(JSON.stringify({ type: 'newPin', pin }));
        notifiedPins.add(pin._id);
      }
      fetchPins();
      closeAddAlertPage();
      speak('Alert added successfully');
    } else {
      const errorData = await response.json();
      alert(`Failed to add alert: ${errorData.message}`);
    }
  } catch (err) {
    console.error('Add pin error:', err);
    alert('Error adding alert. Check your media file (max 5MB, image only).');
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
      closeAlertsPage();
    } else {
      const errorData = await response.json();
      alert(errorData.message);
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
      closeAlertsPage();
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
      const errorData = await response.json();
      alert(`Failed to fetch comments: ${errorData.message}`);
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
      alert(errorData.message);
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
      alert(errorData.message);
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
      alert(errorData.message);
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
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      if (markers[pinId]) {
        markers[pinId].setMap(null);
        delete markers[pinId];
      }
      fetchPins();
      closeAlertsPage();
    } else {
      const errorData = await response.json();
      alert(errorData.message);
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
      closeAlertsPage();
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
  closeAlertsPage();
}

async function fetchPins() {
  try {
    const pinResponse = await fetch('https://pinmap-website.onrender.com/pins', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (pinResponse.status === 401) {
      signOut();
      alert('Session expired. Please log in again.');
      return;
    }
    if (!pinResponse.ok) {
      throw new Error(`Failed to fetch pins: ${pinResponse.statusText}`);
    }
    const pins = await pinResponse.json();

    Object.keys(markers).forEach(pinId => {
      if (!pins.some(pin => pin._id === pinId)) {
        markers[pinId].setMap(null);
        delete markers[pinId];
      }
    });

    pins.forEach(pin => {
      if (!markers[pin._id]) {
        let icon;
        if (pin.description.toLowerCase().includes('cop') || pin.description.toLowerCase().includes('police')) {
          icon = { url: 'https://img.icons8.com/?size=100&id=fHTZqkybfaA7&format=png&color=000000', scaledSize: new google.maps.Size(32, 32) };
        } else if (pin.pinType === 'business') {
          icon = { url: 'https://img.icons8.com/?size=100&id=8312&format=png&color=FFD700', scaledSize: new google.maps.Size(32, 32) };
        } else {
          icon = { url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png' };
        }
        markers[pin._id] = new google.maps.Marker({
          position: { lat: pin.latitude, lng: pin.longitude },
          map: map,
          title: pin.description,
          icon: icon
        });
      }
    });
  } catch (err) {
    console.error('Fetch pins error:', err);
    alert('Error fetching pins: ' + err.message);
  }
}

function showAlertsPage() {
  const alertsPage = document.createElement('div');
  alertsPage.className = 'alerts-page';
  alertsPage.innerHTML = `
    <h2>Alerts</h2>
    <div id="pin-list"></div>
    <button class="back-btn" onclick="closeAlertsPage()">Back to Map</button>
  `;
  document.body.appendChild(alertsPage);
  document.getElementById('map-container').style.display = 'none';

  fetch('https://pinmap-website.onrender.com/pins', {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(response => {
    if (response.status === 401) {
      signOut();
      alert('Session expired. Please log in again.');
      return;
    }
    return response.json();
  }).then(pins => {
    const pinList = alertsPage.querySelector('#pin-list');
    pinList.innerHTML = `
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
        <tbody></tbody>
      </table>
    `;
    const tableBody = pinList.querySelector('tbody');
    pins.forEach(pin => {
      if (pin.pinType !== 'alert') return;
      const isOwnPin = pin.userId._id === userId;
      const canRemove = isAdmin || isOwnPin;
      const row = document.createElement('tr');
      row.innerHTML = `
        <td data-label="Description">${pin.description}</td>
        <td data-label="Latitude">${pin.latitude.toFixed(4)}</td>
        <td data-label="Longitude">${pin.longitude.toFixed(4)}</td>
        <td data-label="Posted By">
          <span onclick="viewProfile('${pin.userId._id}')" style="cursor: pointer; color: #00adef;">
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
            <button class="standard-btn extend-btn" onclick="${canRemove ? `extendPin('${pin._id}')` : `alert('Only the pin owner or admin can extend')`}" ${!canRemove ? 'disabled' : ''}>Extend</button>
            <button class="standard-btn verify-btn" onclick="verifyPin('${pin._id}')">Verify (${pin.verifications.length})</button>
            <button class="standard-btn vote-btn" onclick="voteToRemove('${pin._id}')">Vote (${pin.voteCount}/8)</button>
            <button class="standard-btn comment-btn" onclick="showComments('${pin._id}')">Comments (${pin.comments.length})</button>
          </div>
          ${isMobile ? `<div class="action-btn" onclick='showToolsModal(${JSON.stringify(pin)})'>Actions</div>` : ''}
        </td>
      `;
      tableBody.appendChild(row);
    });
  }).catch(err => {
    console.error('Fetch alerts error:', err);
    alert('Error loading alerts');
  });
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

function closeAlertsPage() {
  const alertsPage = document.querySelector('.alerts-page');
  if (alertsPage) alertsPage.remove();
  document.getElementById('map-container').style.display = 'block';
}

function showAddAlertPage() {
  const addAlertPage = document.createElement('div');
  addAlertPage.className = 'add-alert-page';
  addAlertPage.innerHTML = `
    <h2>Add Alert</h2>
    <select id="pin-type">
      <option value="">Select Alert Type</option>
      <option value="cop">Cop</option>
      <option value="shooting">Shooting</option>
      <option value="fire">Fire</option>
      <option value="roadblock">Roadblock</option>
      <option value="wreck">Wreck/Crash</option>
      ${isAdmin ? '<option value="business">Business (Admin)</option>' : ''}
    </select>
    <input type="text" id="description" placeholder="Alert Description" maxlength="100">
    <input type="file" id="media-upload" accept="image/*">
    <button onclick="addPin()">Add Alert</button>
    <button class="back-btn" onclick="closeAddAlertPage()">Back to Map</button>
  `;
  document.body.appendChild(addAlertPage);
  document.getElementById('map-container').style.display = 'none';
}

function closeAddAlertPage() {
  const addAlertPage = document.querySelector('.add-alert-page');
  if (addAlertPage) addAlertPage.remove();
  document.getElementById('map-container').style.display = 'block';
}

function viewMedia(mediaPath) {
  const mediaView = document.createElement('div');
  mediaView.className = 'media-view';
  mediaView.innerHTML = `
    <div class="media-container">
      <img id="media-image" style="display: none;" alt="Alert Media">
      <video id="media-video" controls style="display: none;"></video>
      <button onclick="closeMediaView()">Close</button>
    </div>
  `;
  document.body.appendChild(mediaView);
  document.getElementById('map-container').style.display = 'none';
  const mediaImage = mediaView.querySelector('#media-image');
  const mediaVideo = mediaView.querySelector('#media-video');
  mediaImage.style.display = 'none';
  mediaVideo.style.display = 'none';
  if (mediaPath.endsWith('.mp4') || mediaPath.endsWith('.webm')) {
    mediaVideo.src = `https://pinmap-website.onrender.com${mediaPath}`;
    mediaVideo.style.display = 'block';
  } else {
    mediaImage.src = `https://pinmap-website.onrender.com${mediaPath}`;
    mediaImage.style.display = 'block';
  }
}

function closeMediaView() {
  const mediaView = document.querySelector('.media-view');
  if (mediaView) {
    const mediaVideo = mediaView.querySelector('#media-video');
    if (mediaVideo) {
      mediaVideo.pause();
      mediaVideo.src = '';
    }
    mediaView.remove();
  }
  document.getElementById('map-container').style.display = 'block';
}

async function viewProfile(userIdToView) {
  try {
    const response = await fetch(`https://pinmap-website.onrender.com/auth/profile/${userIdToView}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      const profile = await response.json();
      const profileView = document.createElement('div');
      profileView.className = 'profile-view-container';
      profileView.innerHTML = `
        <h2>User Profile</h2>
        <div class="profile-picture-section">
          <img id="view-profile-picture" src="${profile.profilePicture ? `https://pinmap-website.onrender.com${profile.profilePicture}` : 'https://via.placeholder.com/150'}" alt="Profile Picture">
        </div>
        <div class="profile-details">
          <p><strong>Username:</strong> <span id="view-username">${profile.username || profile.email}</span></p>
          <p><strong>Location:</strong> <span id="view-location">${profile.location || 'Not set'}</span></p>
          <p><strong>Current Pins:</strong> <span id="view-pin-count">${profile.totalPins || 0}</span></p>
          <p><strong>Reputation:</strong> <span id="view-reputation">${profile.reputation || 0}</span></p>
          <p><strong>Badges:</strong> <span id="view-badges">${profile.badges ? profile.badges.join(', ') : 'None'}</span></p>
        </div>
        <button onclick="closeProfileView()">Close</button>
      `;
      document.body.appendChild(profileView);
      document.getElementById('map-container').style.display = 'none';
    } else {
      const errorData = await response.json();
      alert(`Failed to fetch user profile: ${errorData.message}`);
    }
  } catch (err) {
    console.error('View profile error:', err);
    alert('Error viewing profile');
  }
}

function closeProfileView() {
  const profileView = document.querySelector('.profile-view-container');
  if (profileView) profileView.remove();
  document.getElementById('map-container').style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', login);
  }
});
