async function register() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  const username = document.getElementById('username').value.trim();
  const birthdate = document.getElementById('birthdate').value;
  const sex = document.getElementById('sex').value;
  const location = document.getElementById('location').value.trim();
  const profilePicture = document.getElementById('profile-picture').files[0];

  if (!email || !password) {
    alert('Email and password are required');
    return;
  }

  const formData = new FormData();
  formData.append('email', email);
  formData.append('password', password);
  if (username) formData.append('username', username);
  if (birthdate) formData.append('birthdate', birthdate);
  formData.append('sex', sex);
  formData.append('location', location);
  if (profilePicture) formData.append('profilePicture', profilePicture);

  try {
    const response = await fetch('https://pinmap-website.onrender.com/auth/register', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json(); // Parse JSON here to check the error

    if (response.ok) {
      const registerForm = document.getElementById('register-form');
      const successModal = document.getElementById('success-modal');

      if (registerForm) registerForm.style.display = 'none';
      if (successModal) successModal.style.display = 'block';
      else alert('Registration successful! Redirecting to login...');

      setTimeout(() => {
        window.location.href = 'index.html';
      }, 2000);
    } else {
       // Check if the error is specifically about duplicate key
        if (data.message && data.message.includes('duplicate key error')) {
            // Redirect to login page
            alert('Account created, redirecting to login');
            window.location.href = 'index.html';
        } else {
            // Handle other errors
            alert(`Registration failed: ${data.message || 'Unknown error'}`);
        }
    }
  } catch (err) {
    console.error('Registration error:', err);
    alert('Error during registration. Please try again.');
  }
}

function previewProfilePicture(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const preview = document.getElementById('profile-picture-preview');
      if (preview) {
        preview.src = e.target.result;
        preview.style.display = 'block';
      }
    };
    reader.readAsDataURL(file);
  }
}

// Event listeners
const profilePictureInput = document.getElementById('profile-picture');
if (profilePictureInput) {
  profilePictureInput.addEventListener('change', previewProfilePicture);
}
