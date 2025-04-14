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
    speak('Unable to drop alert. Current location not available.');
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
      speak('Alert dropped successfully.');
      currentLatLng = null;
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

  const trafficLayer = new google.maps.TrafficLayer();
  trafficLayer.setMap(map);

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
      const bizOption = document.querySelector('#pin-type option[value="business"]');
      if (bizOption) bizOption.style.display = isAdmin ? 'block' : 'none';

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
          const pinControls = document.querySelector('.pin-controls');
          pinControls.classList.toggle('active');
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
      // No longer need to fetch pins here since pin-list is on a separate page
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

function addChatMessage(data) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return; // Chat messages are on a separate page
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
  window.location.href = 'chat.html';
}

function startMap() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
        console.log('Initial position:', userLocation);
        map.setCenter(userLocation);
        updateUserLocation(userLocation.lat, userLocation.lng);
        startLocationTracking();

        // Check if we need to center on a specific pin (from alerts page)
        const centerLat = localStorage.getItem('centerLat');
        const centerLng = localStorage.getItem('centerLng');
        if (centerLat && centerLng) {
          map.setCenter({ lat: parseFloat(centerLat), lng: parseFloat(centerLng) });
          map.setZoom(15);
          localStorage.removeItem('centerLat');
          localStorage.removeItem('centerLng');
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
        map.setCenter({ lat: 33.0801, lng: -83.2321 });
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  } else {
    map.setCenter({ lat: 33.0801, lng: -83.2321 });
  }

  // Fetch pins to display on the map
  fetch('https://pinmap-website.onrender.com/pins', {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  .then(response => response.json())
  .then(pins => {
    pins.forEach(pin => {
      let icon;
      if (pin.description.toLowerCase().includes('cop') || pin.description.toLowerCase().includes('police')) {
        icon = { url: 'https://img.icons8.com/?size=100&id=fHTZqkybfaA7&format=png&color=000000', scaledSize: new google.maps.Size(32, 32) };
      } else if (pin.pinType === 'business') {
        icon = { url: 'https://img.icons8.com/?size=100&id=8312&format=png&color=FFD700', scaledSize: new google.maps.Size(32, 32) };
      } else {
        icon = { url: 'https://img.icons8.com/ios-filled/24/ffffff/warning-shield.png', scaledSize: new google.maps.Size(32, 32) };
      }
      const marker = new google.maps.Marker({
        position: { lat: pin.latitude, lng: pin.longitude },
        map: map,
        title: pin.description,
        icon: icon
      });
      markers[pin._id] = marker;

      // Add click listener to navigate to alerts page
      marker.addListener('click', () => {
        window.location.href = 'alerts.html';
      });
    });
  })
  .catch(err => {
    console.error('Error fetching pins for map:', err);
    alert('Error loading pins on map.');
  });

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

function updateUserLocation(lat, lng, speed = 0) {
  const newPos = { lat, lng };
  userPath.push(newPos);

  lastSpeed = speed ? (speed * 2.23694).toFixed(1) : lastSpeed;
  
  if (isMobile) {
    const hud = document.querySelector('.gps-hud');
    if (hud) {
      hud.querySelector('.speed').textContent = `Speed: ${lastSpeed} mph`;
      hud.querySelector('.street').textContent = `Street: Main Street`; // Simulated
      hud.querySelector('.eta').textContent = `ETA: ${document.getElementById('time-to-destination')?.textContent || '--'}`;
      hud.querySelector('.distance').textContent = `Distance: ${document.getElementById('distance-to-destination')?.textContent || '--'}`;

      // Simulated speed camera alert (replace with real data as needed)
      const distanceToCamera = 0.2; // Simulated distance in miles
      hud.querySelector('.alert').textContent = `Speed camera in ${distanceToCamera} miles`;
    }
  } else {
    document.getElementById('current-speed').textContent = `${lastSpeed} mph`;
  }

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

  fetchSpeedLimit(lat, lng);
}

function fetchSpeedLimit(lat, lng) {
  speedLimit = '35 mph'; // Simulated
  if (!isMobile) {
    document.getElementById('speed-limit').textContent = speedLimit;
  }
}

function startLocationTracking() {
  if (navigator.geolocation && !trackingPaused) {
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        console.log('New position:', position.coords.latitude, position.coords.longitude);
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
        fetch('https://pinmap-website.onrender.com/auth/location', {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude: userLocation.lat, longitude: userLocation.lng })
        }).catch(err => console.error('Error updating location:', err));

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
      currentRoute = result;
      const route = result.routes[0];
      const leg = route.legs[0];
      const duration = leg.duration_in_traffic || leg.duration;
      const distance = leg.distance;
      const normalDuration = leg.duration.value;
      const trafficDuration = leg.duration_in_traffic ? leg.duration_in_traffic.value : normalDuration;

      if (!isMobile) {
        document.getElementById('time-to-destination').textContent = duration.text;
        document.getElementById('distance-to-destination').textContent = distance.text;
      }

      currentDestination = document.getElementById('address-search').value;
      updateUserLocation(origin.lat(), origin.lng(), lastSpeed);

      if (trafficDuration > normalDuration * 1.2) {
        alert(`Traffic delay detected! Estimated travel time: ${duration.text}`);
        if (voiceNavigationEnabled) speak(`Traffic delay detected. Estimated travel time: ${duration.text}`);
      }

      const pinResponse = await fetch('https://pinmap-website.onrender.com/pins', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const pins = await pinResponse.json();
      const routePath = route.overview_path;
      const alerts = pins.filter(pin => {
        if (pin.pinType !== 'alert') return false;
        const pinPos = new google.maps.LatLng(pin.latitude, pin.longitude);
        return routePath.some(point => google.maps.geometry.spherical.computeDistanceBetween(point, pinPos) < 500);
      });

      if (alerts.length > 0) {
        const alertMessages = alerts.map(pin => pin.description).join(', ');
        alert(`Alerts on your route: ${alertMessages}`);
        if (voiceNavigationEnabled) speak(`Alerts on your route: ${alertMessages}`);
      }

      if (voiceNavigationEnabled) {
        speakNextInstruction();
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
  document.getElementById('chat-messages').innerHTML = '';
  document.getElementById('messages-btn').textContent = 'Messages';
  if (isMobile) {
    document.getElementById('mobile-messages-btn').textContent = 'Messages';
  }
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
      document.getElementById('pin-type').value = '';
      document.getElementById('description').value = '';
      document.getElementById('media-upload').value = '';
      currentLatLng = null;
      if (isMobile) {
        document.querySelector('.pin-controls').classList.remove('active');
      }
    } else {
      const errorData = await postResponse.json();
      alert(`Failed to add alert: ${errorData.message || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('Add pin error:', err);
    alert('Error adding alert. Check your media file (max 5MB, image only) and try again.');
  }
}

function editProfile() {
  window.location.href = 'profile.html';
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

function showAlertsPage() {
  window.location.href = 'alerts.html';
}

document.addEventListener('DOMContentLoaded', () => {
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', login);
  }
});
