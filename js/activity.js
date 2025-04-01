let token = localStorage.getItem('token');

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
      fetchUserActivity();
    }
  } catch (err) {
    console.error('Invalid token:', err);
    signOut();
  }
}

function signOut() {
  localStorage.removeItem('token');
  window.location.href = 'index.html';
}

async function fetchUserActivity() {
  const urlParams = new URLSearchParams(window.location.search);
  const userId = urlParams.get('userId');
  
  if (!userId) {
    alert('No user ID specified. Returning to admin panel.');
    window.location.href = 'admin.html';
    return;
  }

  try {
    const response = await fetch(`https://pinmap-website.onrender.com/auth/profile/${userId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.status === 401) {
      signOut();
      alert('Session expired. Please log in again.');
      return;
    }
    const user = await response.json();

    const picture = document.getElementById('activity-profile-picture');
    if (user.profilePicture) {
      picture.src = `https://pinmap-website.onrender.com${user.profilePicture}`;
      picture.style.display = 'block';
    } else {
      picture.style.display = 'none';
    }

    document.getElementById('activity-username').textContent = user.username || 'Unknown';
    document.getElementById('activity-birthdate').textContent = user.birthdate ? 
      new Date(user.birthdate).toLocaleDateString() : 'Not specified';
    document.getElementById('activity-join-date').textContent = new Date(user.joinDate).toLocaleDateString();
    document.getElementById('activity-current-pins').textContent = user.currentPins;
    document.getElementById('activity-total-pins').textContent = user.totalPins;
    document.getElementById('activity-last-online').textContent = user.lastLogin ? 
      new Date(user.lastLogin).toLocaleString() : 'Never';
    const statusSpan = document.getElementById('activity-status');
    statusSpan.textContent = user.onlineStatus;
    statusSpan.className = user.onlineStatus === 'Online' ? 'online-status' : 'offline-status';
  } catch (err) {
    console.error('Fetch user activity error:', err);
    alert('Error fetching user activity: ' + err.message);
    window.location.href = 'admin.html';
  }
}

checkAdmin();
