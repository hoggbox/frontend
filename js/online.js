let token = localStorage.getItem('token');
let ws;

function checkAdmin() {
  if (!token) {
    window.location.href = 'index.html';
    return;
  }
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.email !== 'imhoggbox@gmail.com') {
      alert('Access denied: Admin only');
      window.location.href = 'index.html';
    } else {
      setupWebSocket();
    }
  } catch (err) {
    console.error('Invalid token:', err);
    signOut();
  }
}

function signOut() {
  localStorage.removeItem('token');
  if (ws) ws.close();
  window.location.href = 'index.html';
}

function setupWebSocket() {
  ws = new WebSocket('wss://pinmap-website.onrender.com');
  ws.onopen = () => {
    console.log('WebSocket connected');
    fetch(`https://pinmap-website.onrender.com/set-ws-email?email=${encodeURIComponent('imhoggbox@gmail.com')}&userId=${encodeURIComponent('admin')}`);
  };
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'onlineUsers') {
      updateOnlineUsers(data.users);
    }
  };
  ws.onclose = () => {
    console.log('WebSocket disconnected');
    alert('WebSocket connection lost. Returning to admin panel.');
    window.location.href = 'admin.html';
  };
  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
    alert('WebSocket error occurred. Check your connection.');
  };
}

function updateOnlineUsers(users) {
  const onlineList = document.getElementById('online-list');
  onlineList.innerHTML = '';

  if (users.length === 0) {
    onlineList.innerHTML = '<p>No users currently online.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'pin-table';
  table.innerHTML = `
    <tr>
      <th>Email</th>
      <th>Latitude</th>
      <th>Longitude</th>
      <th>Last Update (ET)</th>
    </tr>
  `;
  users.forEach(user => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${user.email}</td>
      <td>${user.latitude ? user.latitude.toFixed(6) : 'Unknown'}</td>
      <td>${user.longitude ? user.longitude.toFixed(6) : 'Unknown'}</td>
      <td>${new Date(user.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' })}</td>
    `;
    table.appendChild(row);
  });
  onlineList.appendChild(table);
}

checkAdmin();
