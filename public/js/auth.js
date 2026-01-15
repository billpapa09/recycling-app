// Σύνδεση χρήστη

document.addEventListener('DOMContentLoaded', () => {
    // Αν ο χρήστης είναι ήδη συνδεδεμένος
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (currentUser) {
        window.location.href = 'map.html';
        return;
    }

    const form = document.getElementById('authForm');
    const statusMessage = document.getElementById('statusMessage');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const firstName = document.getElementById('firstName').value.trim();
        const lastName = document.getElementById('lastName').value.trim();

        if (!firstName || !lastName) {
            showMessage('Συμπληρώστε όνομα και επώνυμο', 'error');
            return;
        }

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ firstName, lastName })
            });

            const data = await response.json();

            if (response.ok) {
                localStorage.setItem('currentUser', JSON.stringify(data.user));
                window.location.href = 'map.html';
            } else {
                showMessage(data.error || 'Σφάλμα σύνδεσης', 'error');
            }
        } catch (error) {
            console.error('Σφάλμα:', error);
            showMessage('Σφάλμα σύνδεσης με τον διακομιστή', 'error');
        }
    });

    function showMessage(text, type) {
        statusMessage.textContent = text;
        statusMessage.className = `status-message ${type}`;
        statusMessage.classList.remove('hidden');
    }
});
