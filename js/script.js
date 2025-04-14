// js/script.js

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
let voiceNavigationEnabled = false;
let currentDestination = null;
let currentRoute = null;
let lastSpokenInstruction = null;
let recognition; // For voice commands

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
  if (!voiceNavigationEnabled || !currentRoute) return;

  const steps = currentRoute.routes[0].legs[0].steps;
  if (!userLocationMarker) return;

  const userPos = userLocationMarker.getPosition();
  let closestStep = null;
  let closestDistance = Infinity;

  steps.forEach((step, index) => {
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

function initVoiceCommands() {
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
      console.log('Voice command detected:', transcript);
      if (transcript.includes('drop alert')) {
        speak('Dropping alert at your current location.');
        dropAlertAtCurrentLocation();
      }
    };

    recognition.onend = () => {
      if (voiceNavigationEnabled) {
        recognition.start();
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
    };
  } else {
    console.warn('Speech recognition not supported in this browser.');
  }
}

async function dropAlertAtCurrentLocation() {
  if (!userLocationMarker) {
    speak('Unable to drop alert. Current location not available. Please enable location services.');
    return;
  }

  const position = userLocationMarker.getPosition();
  currentLatLng = { lat: position.lat(), lng: position.lng() };
  
  try {
    const response = await fetch('https://pinmap-website.onrender.com/pins', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (response.status === 401) {
      signOut();
      return speak('Session expired. Please log in again.');
    }
    const pins = await response.json();
    const tooClose = pins.some(pin => getDistance(currentLatLng.lat, currentLatLng.lng, pin.latitude, pin.longitude) < 304.8);
    if (tooClose) {
      const closestPin = pins.find(pin => getDistance(currentLatLng.lat, currentLatLng.lng, pin.latitude, pin.longitude) < 304.8);
      speak(`Alert too close to existing pin at latitude ${closestPin.latitude.toFixed(4)}, longitude ${closestPin.longitude.toFixed(4)}`);
      currentLatLng = null;
      return;
    }

    const description = 'Voice-Dropped Alert'; // Default description for voice command
    const formData = new FormData();
    formData.append('latitude', currentLatLng.lat);
    formData.append('longitude', currentLatLng.lng);
    formData.append('description', description);
    formData.append('pinType', 'alert');

    const postResponse = await fetch('https://pinmap-website.onrender.com/pins', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });

    if (postResponse.ok) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'newPin', pin: { latitude: currentLatLng.lat, longitude: currentLatLng.lng, description } }));
      }
      speak('Alert dropped successfully. Check the Alerts page to view it.');
      currentLatLng = null;

      // Add marker to the map immediately
      const marker = new google.maps.Marker({
        position: { lat: position.lat(), lng: position.lng() },
        map: map,
        title: description,
        icon: { url: 'https://img.icons8.com/ios-filled/24/ffffff/warning-shield.png', scaledSize: new google.maps.Size(32, 32) }
      });
      marker.addListener('click', () => {
        window.location.href = 'alerts.html';
      });
      markers[Date.now().toString()] = marker; // Temporary ID until fetched from server
    } else {
      const errorData = await postResponse.json();
      speak(`Failed to drop alert: ${errorData.message || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('Voice drop alert error:', err);
    speak('Error dropping alert. Please try again.');
  }
}

function initMap() {  
  // More detailed map style with landmarks and POIs
  const detailedMapStyle = [
    {
      "elementType": "geometry",
      "stylers": [
        { "color": "#242f3e" }
      ]
    },
    {
      "elementType": "labels.text.fill",
      "stylers": [
        { "color": "#746855" }
      ]
    },
    {
      "elementType": "labels.text.stroke",
      "stylers": [
        { "color": "#242f3e" }
      ]
    },
    {
      "featureType": "administrative.locality",
      "elementType": "labels.text.fill",
      "stylers": [
        { "color": "#d59563" }
      ]
    },
    {
      "featureType": "poi",
      "elementType": "labels.text.fill",
      "stylers": [
        { "color": "#d59563" }
      ]
    },
    {
      "featureType": "poi.park",
      "elementType": "geometry",
      "stylers": [
        { "color": "#263c3f" }
      ]
    },
    {
      "featureType": "poi.park",
      "elementType": "labels.text.fill",
      "stylers": [
        { "color": "#6b9a76" }
      ]
    },
    {
      "featureType": "road",
      "elementType": "geometry",
      "stylers": [
        { "color": "#38414e" }
      ]
    },
    {
      "featureType": "road",
      "elementType": "geometry.stroke",
      "stylers": [
        { "color": "#212a37" }
      ]
    },
    {
      "featureType": "road",
      "elementType": "labels.text.fill",
      "stylers": [
        { "color": "#9ca5b3" }
      ]
    },
    {
      "featureType": "road.highway",
      "elementType": "geometry",
      "stylers": [
        { "color": "#746855" }
      ]
    },
    {
      "featureType": "road.highway",
      "elementType": "geometry.stroke",
      "stylers": [
        { "color": "#1f2835" }
      ]
    },
    {
      "featureType": "road.highway",
      "elementType": "labels.text.fill",
      "stylers": [
        { "color": "#f3d19c" }
      ]
    },
    {
      "featureType": "transit",
      "elementType": "geometry",
      "stylers": [
        { "color": "#2f3948" }
      ]
    },
    {
      "featureType": "transit.station",
      "elementType": "labels.text.fill",
      "stylers": [
        { "color": "#d59563" }
      ]
    },
    {
      "featureType": "water",
      "elementType": "geometry",
      "stylers": [
        { "color": "#17263c" }
      ]
    },
    {
      "featureType": "water",
      "elementType": "labels.text.fill",
      "stylers": [
        { "color": "#515c6d" }
      ]
    },
    {
      "featureType": "water",
      "elementType": "labels.text.stroke",
      "stylers": [
        { "color": "#17263c" }
      ]
    }
  ];

  map = new google.maps.Map(document.getElementById('map'), {
    zoom: 14, // Increased zoom for more detail
    styles: detailedMapStyle,
    zoomControl: true, // Add zoom controls
    mapTypeControl: true, // Allow switching map types (e.g., satellite)
    streetViewControl: true, // Enable Street View
    fullscreenControl: true, // Enable fullscreen option
  });

  geocoder = new google.maps.Geocoder();
  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map: map,
    suppressMarkers: true,
    polylineOptions: { strokeColor: '#1E90FF', strokeWeight: 5 }
  });

  const trafficLayer = new google.maps.TrafficLayer();
  trafficLayer.setMap(map);

  // Add a map legend
  const legend = document.createElement('div');
  legend.className = 'map-legend';
  legend.innerHTML = `
    <div class="legend-item"><span style="background: #ff0000;"></span> Police</div>
    <div class="legend-item"><span style="background: #ffd700;"></span> Business</div>
    <div class="legend-item"><span style="background: #ffeb3b;"></span> Alert</div>
    <div class="legend-item"><span style="background: #0000ff;"></span> Your Location</div>
  `;
  map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(legend);

  // Add a button to center on user's location
  const locationButton = document.createElement('button');
  locationButton.className = 'custom-map-control';
  locationButton.innerHTML = '📍';
  locationButton.title = 'Center on My Location';
  locationButton.addEventListener('click', () => {
    if (userLocationMarker) {
      map.panTo(userLocationMarker.getPositionSZ());
      map.setZoom(15);
    } else {
      alert('Location not available. Please enable location services.');
    }
  });
  map.controls[google.maps.ControlPosition.RIGHT_TOP].push(locationButton);

  isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

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
      setupWebSocket();
      checkNewMessages();
      subscribeToPush();
      document.getElementById('admin-btn').style.display = isAdmin ? 'inline-block' : 'none';
      if (isMobile) {
        document.getElementById('mobile-admin-btn').style.display = isAdmin ? 'inline-block' : 'none';
      }

      setupMenuDropdown();

      if (isMobile) {
        const hud = document.createElement('div');
        hud.className = 'gps-hud';
        hud.innerHTML = `
          <div class="speed-container">
            <div class="speed-icon"></div>
            <p class="speed">Speed: 0 mph</p>
          </div>
          <p class="street">Street: Not set</p>
          <div class="alert-container">
            <div class="alert-icon"></div>
            <p class="alert">No alerts</p>
          </div>
          <div class="eta-distance">
            <p class="eta">ETA: --</p>
            <p class="distance">Distance: --</p>
          </div>
        `;
        document.getElementById('map-container').appendChild(hud);

        const fab = document.createElement('div');
        fab.className = 'fab-pin';
        fab.innerHTML = '+';
        fab.addEventListener('click', () => {
          // Store the current location to use in add-alert.html
          if (userLocationMarker) {
            const position = userLocationMarker.getPosition();
            localStorage.setItem('currentLatLng', JSON.stringify({ lat: position.lat(), lng: position.lng() }));
            window.location.href = 'add-alert.html';
          } else {
            alert('Location not available. Please enable location services and try again.');
          }
        });
        document.body.appendChild(fab);

        const voiceToggle = document.createElement('div');
        voiceToggle.className = 'voice-toggle';
        voiceToggle.innerHTML = '🎙️';
        voiceToggle.addEventListener('click', () => {
          voiceNavigationEnabled = !voiceNavigationEnabled;
          voiceToggle.classList.toggle('active', voiceNavigationEnabled);
          if (voiceNavigationEnabled) {
            speak('Voice navigation enabled');
            speakNextInstruction();
            if (recognition) recognition.start();
          } else {
            speak('Voice navigation disabled');
            if (recognition) recognition.stop();
          }
        });
        document.body.appendChild(voiceToggle);

        initVoiceCommands();
      }
    } catch (err) {
      console.error('Invalid token:', err);
      signOut();
    }
  } else {
    showLogin();
  }

  document.getElementById('profile-picture')?.addEventListener('change', (event) => {
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
  if (isMobile) {
    document.getElementById('mobile-admin-btn').style.display = isAdmin ? 'inline-block' : 'none';
  }
}

function showChatPage() {
  window.location.href = 'chat.html';
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
      // Refresh pins on the map
      refreshMapPins();
    } else if (data.type === 'newComment') {
      // Pin comments are handled on the alerts page
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
