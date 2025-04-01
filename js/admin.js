let token = localStorage.getItem('token');
let currentFilter = 'all';
let currentPage = 1;
const usersPerPage = 10;
let searchQuery = '';
let sortColumn = null;
let sortDirection = true;
let chart;

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
      fetchUsers();
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

async function fetchUsers() {
  try {
    const response = await fetch('https://pinmap-website.onrender.com/auth/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.status === 401) {
      signOut();
      alert('Session expired. Please log in again.');
      return;
    }
    if (response.status === 403) {
      alert('Access denied: Admin only');
      window.location.href = 'index.html';
      return;
    }
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const users = await response.json();
    const filteredUsers = applyFilter(users);
    const sortedUsers = sortColumn ? sortUsers(filteredUsers, sortColumn) : filteredUsers;

    const userList = document.getElementById('user-list');
    userList.innerHTML = '';

    const totalUsers = sortedUsers.length;
    const totalPages = Math.ceil(totalUsers / usersPerPage);
    const startIndex = (currentPage - 1) * usersPerPage;
    const paginatedUsers = sortedUsers.slice(startIndex, startIndex + usersPerPage);

    const table = document.createElement('table');
    table.className = 'pin-table';
    table.innerHTML = `
      <tr>
        <th><input type="checkbox" id="select-all" onchange="toggleSelectAll(this.checked)"></th>
        <th class="sortable" onclick="sortTable('email')">Email</th>
        <th class="sortable" onclick="sortTable('username')">Username</th>
        <th class="sortable" onclick="sortTable('ipAddress')">IP Address</th>
        <th class="sortable" onclick="sortTable('joinDate')">Join Date</th>
        <th class="sortable" onclick="sortTable('lastLogin')">Last Login</th>
        <th>Activity</th>
        <th>Actions</th>
      </tr>
    `;
    paginatedUsers.forEach(user => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><input type="checkbox" class="user-select" value="${user._id}"></td>
        <td>${user.email}</td>
        <td>${user.username || '-'}</td>
        <td>${user.ipAddress || 'Unknown'}</td>
        <td>${new Date(user.joinDate).toLocaleString('en-US', { timeZone: 'America/New_York' })}</td>
        <td>${user.lastLogin ? new Date(user.lastLogin).toLocaleString('en-US', { timeZone: 'America/New_York' }) : 'Never'}</td>
        <td><button class="go-to-btn" onclick="window.location.href='activity.html?userId=${user._id}'">View Activity</button></td>
        <td>
          <button class="remove-btn" onclick="deleteUser('${user._id}')">Delete</button>
          <button class="ban-btn" onclick="banUser('${user.ipAddress}')">Ban IP</button>
        </td>
      `;
      table.appendChild(row);
    });
    userList.appendChild(table);

    const paginationContainer = document.createElement('div');
    paginationContainer.className = 'pagination-container';
    paginationContainer.innerHTML = `
      <button ${currentPage === 1 ? 'disabled' : ''} onclick="if (currentPage > 1) { currentPage--; fetchUsers(); }">Previous</button>
      <span>Page ${currentPage} of ${totalPages}</span>
      <button ${currentPage === totalPages ? 'disabled' : ''} onclick="if (currentPage < ${totalPages}) { currentPage++; fetchUsers(); }">Next</button>
    `;
    userList.appendChild(paginationContainer);

    updateChart(users);
  } catch (err) {
    console.error('Fetch users error:', err);
    alert('Error fetching users: ' + err.message);
  }
}

function applyFilter(users) {
  let filteredUsers = [...users];
  if (searchQuery) {
    const queryLower = searchQuery.toLowerCase();
    filteredUsers = filteredUsers.filter(user => 
      (user.email.toLowerCase().includes(queryLower)) ||
      (user.username && user.username.toLowerCase().includes(queryLower))
    );
  }
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  switch (currentFilter) {
    case 'newest': filteredUsers.sort((a, b) => new Date(b.joinDate) - new Date(a.joinDate)); break;
    case 'oldest': filteredUsers.sort((a, b) => new Date(a.joinDate) - new Date(b.joinDate)); break;
    case 'active': filteredUsers = filteredUsers.filter(user => user.lastLogin && new Date(user.lastLogin) > thirtyDaysAgo); break;
    case 'highActivity': filteredUsers = filteredUsers.filter(user => user.totalPins > 10); break;
    case 'banned': filteredUsers = filteredUsers.filter(user => user.isBanned); break;
    case 'all': break;
  }
  return filteredUsers;
}

function sortUsers(users, column) {
  if (sortColumn === column) sortDirection = !sortDirection;
  else { sortColumn = column; sortDirection = true; }
  return users.sort((a, b) => {
    let valA, valB;
    switch (column) {
      case 'email': valA = a.email.toLowerCase(); valB = b.email.toLowerCase(); break;
      case 'username': valA = a.username || ''; valB = b.username || ''; break;
      case 'ipAddress': valA = a.ipAddress || ''; valB = b.ipAddress || ''; break;
      case 'joinDate': valA = new Date(a.joinDate); valB = new Date(b.joinDate); break;
      case 'lastLogin': valA = a.lastLogin ? new Date(a.lastLogin) : new Date(0); valB = b.lastLogin ? new Date(b.lastLogin) : new Date(0); break;
    }
    if (valA < valB) return sortDirection ? -1 : 1;
    if (valA > valB) return sortDirection ? 1 : -1;
    return 0;
  });
}

function sortTable(column) {
  sortColumn = column;
  fetchUsers();
}

function toggleSelectAll(checked) {
  document.querySelectorAll('.user-select').forEach(cb => cb.checked = checked);
}

async function deleteSelected() {
  const selected = Array.from(document.querySelectorAll('.user-select:checked')).map(cb => cb.value);
  if (selected.length === 0) return alert('No users selected');
  if (!confirm(`Are you sure you want to delete ${selected.length} user(s)?`)) return;
  try {
    const response = await fetch('https://pinmap-website.onrender.com/auth/users/bulk-delete', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: selected })
    });
    if (response.ok) {
      alert('Selected users deleted successfully');
      fetchUsers();
    } else {
      const errorText = await response.text();
      alert(`Failed to delete users: ${errorText}`);
    }
  } catch (err) {
    console.error('Delete selected error:', err);
    alert('Error deleting users');
  }
}

async function banSelected() {
  const selected = Array.from(document.querySelectorAll('.user-select:checked')).map(cb => {
    const row = cb.closest('tr');
    return row.cells[3].textContent;
  }).filter(ip => ip && ip !== 'Unknown');
  if (selected.length === 0) return alert('No valid IPs selected');
  if (!confirm(`Are you sure you want to ban ${selected.length} IP(s)?`)) return;
  try {
    const response = await fetch('https://pinmap-website.onrender.com/auth/ban-ip', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ipAddresses: selected })
    });
    if (response.ok) {
      alert('Selected IPs banned successfully');
      fetchUsers();
    } else {
      const errorText = await response.text();
      alert(`Failed to ban IPs: ${errorText}`);
    }
  } catch (err) {
    console.error('Ban selected error:', err);
    alert('Error banning IPs');
  }
}

async function deleteUser(userId) {
  if (!confirm('Are you sure you want to delete this user?')) return;
  try {
    const response = await fetch('https://pinmap-website.onrender.com/auth/users/bulk-delete', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: [userId] })
    });
    if (response.ok) {
      alert('User deleted successfully');
      fetchUsers();
    } else {
      const errorText = await response.text();
      alert(`Failed to delete user: ${errorText}`);
    }
  } catch (err) {
    console.error('Delete user error:', err);
    alert('Error deleting user');
  }
}

async function banUser(ipAddress) {
  if (!ipAddress || ipAddress === 'Unknown') return alert('No IP address to ban');
  if (!confirm(`Are you sure you want to ban IP ${ipAddress}?`)) return;
  try {
    const response = await fetch('https://pinmap-website.onrender.com/auth/ban-ip', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ipAddresses: [ipAddress] })
    });
    if (response.ok) {
      alert('IP banned successfully');
      fetchUsers();
    } else {
      const errorText = await response.text();
      alert(`Failed to ban IP: ${errorText}`);
    }
  } catch (err) {
    console.error('Ban user error:', err);
    alert('Error banning IP');
  }
}

function updateChart(users) {
  if (typeof Chart === 'undefined') {
    console.error('Chart.js not loaded');
    return;
  }
  const ctx = document.getElementById('registration-chart').getContext('2d');
  const registrationsByDate = {};
  users.forEach(user => {
    const date = new Date(user.joinDate).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
    registrationsByDate[date] = (registrationsByDate[date] || 0) + 1;
  });

  const labels = Object.keys(registrationsByDate).sort((a, b) => new Date(a) - new Date(b));
  const data = labels.map(label => registrationsByDate[label]);

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'User Registrations',
        data: data,
        borderColor: '#3498db',
        backgroundColor: 'rgba(52, 152, 219, 0.2)',
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      scales: {
        x: { title: { display: true, text: 'Date' } },
        y: { title: { display: true, text: 'Registrations' }, beginAtZero: true, stepSize: 1 }
      }
    }
  });
}

function exportToCSV() {
  fetch('https://pinmap-website.onrender.com/auth/users', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      return response.json();
    })
    .then(users => {
      const filteredUsers = applyFilter(users);
      const csv = [
        'Email,Username,IP Address,Join Date,Last Login,Total Pins,Banned',
        ...filteredUsers.map(user => 
          `${user.email},${user.username || '-'},${user.ipAddress || 'Unknown'},${new Date(user.joinDate).toISOString()},${user.lastLogin ? new Date(user.lastLogin).toISOString() : 'Never'},${user.totalPins},${user.isBanned}`
        )
      ].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'users_export_' + new Date().toISOString().split('T')[0] + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    })
    .catch(err => {
      console.error('Export error:', err);
      alert('Error exporting to CSV: ' + err.message);
    });
}

document.getElementById('user-filter').onchange = (e) => {
  currentFilter = e.target.value;
  currentPage = 1;
  fetchUsers();
};

document.getElementById('user-search').oninput = (e) => {
  searchQuery = e.target.value.trim();
  currentPage = 1;
  fetchUsers();
};

checkAdmin();
