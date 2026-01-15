// Admin Dashboard JavaScript

document.addEventListener('DOMContentLoaded', () => {
    const passwordModal = document.getElementById('passwordModal');
    const passwordForm = document.getElementById('passwordForm');
    const passwordError = document.getElementById('passwordError');
    const adminDashboard = document.getElementById('adminDashboard');

    // Verify admin password
    passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const password = document.getElementById('adminPassword').value;

        try {
            const response = await fetch('/api/admin/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            if (response.ok) {
                passwordModal.classList.remove('active');
                adminDashboard.classList.remove('hidden');
                loadUsers();
            } else {
                passwordError.textContent = 'Λάθος κωδικός';
                passwordError.classList.remove('hidden');
            }
        } catch (error) {
            passwordError.textContent = 'Σφάλμα σύνδεσης';
            passwordError.classList.remove('hidden');
        }
    });

    // Load users
    async function loadUsers() {
        await loadPendingUsers();
        await loadApprovedUsers();
    }

    async function loadPendingUsers() {
        try {
            const response = await fetch('/api/admin/pending');
            const users = await response.json();

            document.getElementById('pendingCount').textContent = users.length;

            const pendingList = document.getElementById('pendingList');

            if (users.length === 0) {
                pendingList.innerHTML = '<p class="empty-message">Δεν υπάρχουν εκκρεμείς αιτήσεις</p>';
                return;
            }

            pendingList.innerHTML = users.map(user => `
        <div class="user-card pending">
          <div class="user-info">
            <span class="user-name">${user.firstName} ${user.lastName}</span>
            <span class="user-date">${new Date(user.createdAt).toLocaleDateString('el-GR')}</span>
          </div>
          <div class="user-actions">
            <button class="btn btn-success btn-small" onclick="approveUser(${user.id})">✓ Έγκριση</button>
            <button class="btn btn-danger btn-small" onclick="rejectUser(${user.id})">✗ Απόρριψη</button>
          </div>
        </div>
      `).join('');
        } catch (error) {
            console.error('Error loading pending users:', error);
        }
    }

    async function loadApprovedUsers() {
        try {
            const response = await fetch('/api/admin/approved');
            const users = await response.json();

            document.getElementById('approvedCount').textContent = users.length;

            const approvedList = document.getElementById('approvedList');

            if (users.length === 0) {
                approvedList.innerHTML = '<p class="empty-message">Δεν υπάρχουν εγκεκριμένοι χρήστες</p>';
                return;
            }

            approvedList.innerHTML = users.map(user => `
        <div class="user-card approved">
          <div class="user-info">
            <span class="user-name">${user.firstName} ${user.lastName}</span>
            <span class="user-date">${new Date(user.createdAt).toLocaleDateString('el-GR')}</span>
          </div>
          <span class="user-status">✓ Εγκεκριμένος</span>
        </div>
      `).join('');
        } catch (error) {
            console.error('Error loading approved users:', error);
        }
    }

    // Make functions global for onclick handlers
    window.approveUser = async (id) => {
        try {
            await fetch(`/api/admin/approve/${id}`, { method: 'POST' });
            loadUsers();
        } catch (error) {
            console.error('Error approving user:', error);
        }
    };

    window.rejectUser = async (id) => {
        try {
            await fetch(`/api/admin/reject/${id}`, { method: 'POST' });
            loadUsers();
        } catch (error) {
            console.error('Error rejecting user:', error);
        }
    };
});
