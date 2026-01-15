// Map and Tracking JavaScript

let map;
let locations = [];
let currentLocation = null;
let currentUser = null;
let markersLayer;

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser) {
        window.location.href = 'index.html';
        return;
    }

    // Display user name
    document.getElementById('userName').textContent = `${currentUser.firstName} ${currentUser.lastName}`;

    // Logout handler
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
    });

    // Initialize map
    initMap();

    // Load locations and totals
    await loadLocations();
    await updateGrandTotal();

    // Auto-refresh polling (every 5 seconds)
    setInterval(async () => {
        if (!document.hidden) {
            await loadLocations();
            await updateGrandTotal();
        }
    }, 5000);

    // Setup modal handlers
    setupModal();
});

function initMap() {
    // Center on Athens
    map = L.map('map').setView([37.9838, 23.7275], 11);

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
}

async function loadLocations() {
    try {
        if (locations.length === 0) { // Only fetch locations if empty or forced
            const response = await fetch('/api/locations');
            locations = await response.json();
        }

        // Get totals for each location
        const totalsResponse = await fetch('/api/totals');
        const totalsData = await totalsResponse.json();

        // Clear existing markers
        markersLayer.clearLayers();

        // Add markers for each location
        locations.forEach(location => {
            const total = totalsData.locationTotals[location.id] || 0;
            const hasToday = totalsData.todayLocations.includes(location.id);
            const hasSchedule = totalsData.scheduledLocations && totalsData.scheduledLocations.includes(location.id);

            // green = today, orange = not today but has entries, red = never
            let colorClass;
            if (hasToday) {
                colorClass = 'green';
            } else if (total > 0) {
                colorClass = 'orange';
            } else {
                colorClass = 'red';
            }

            // Create custom icon with bottle count
            const markerIcon = L.divIcon({
                className: 'bottle-marker',
                html: `
                    <div class="marker-container">
                        <div class="marker-circle ${colorClass}">${total}</div>
                        ${hasSchedule ? '<div class="schedule-indicator"></div>' : ''}
                    </div>
                `,
                iconSize: [36, 36],
                iconAnchor: [18, 18]
            });

            const marker = L.marker([location.lat, location.lng], {
                icon: markerIcon
            });

            // Bind tooltip with name (shows on tap/hover)
            marker.bindTooltip(location.name, {
                permanent: false,
                direction: 'top',
                offset: [0, -20]
            });

            // Click handler
            marker.on('click', () => openLocationModal(location));

            markersLayer.addLayer(marker);
        });
    } catch (error) {
        console.error('Error loading locations:', error);
    }
}

async function updateGrandTotal() {
    try {
        const response = await fetch('/api/totals');
        const data = await response.json();
        document.getElementById('grandTotal').textContent = data.grandTotal.toLocaleString('el-GR');
    } catch (error) {
        console.error('Error updating grand total:', error);
    }
}

function setupModal() {
    const modal = document.getElementById('entryModal');
    const closeBtn = document.getElementById('closeModal');
    const entryForm = document.getElementById('entryForm');
    const modalContent = modal.querySelector('.modal-content');

    // Reset expansion when modal closes
    const resetModalExpansion = () => {
        if (modalContent) {
            modalContent.classList.remove('expanded');
            modalContent.scrollTop = 0;
        }
    };

    // Close modal
    closeBtn.addEventListener('click', () => {
        modal.classList.remove('active');
        resetModalExpansion();
        currentLocation = null;
    });

    // Mobile: Touch-based bottom sheet drag
    let startY = 0;
    let isDragging = false;

    if (modalContent) {
        modalContent.addEventListener('touchstart', (e) => {
            // Only start drag if touching near the top (drag handle area)
            const rect = modalContent.getBoundingClientRect();
            const touchY = e.touches[0].clientY - rect.top;
            if (touchY < 40) { // First 40px is drag handle area
                startY = e.touches[0].clientY;
                isDragging = true;
                modalContent.classList.add('dragging');
            }
        }, { passive: true });

        modalContent.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            // Visual feedback could be added here
        }, { passive: true });

        modalContent.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            isDragging = false;
            modalContent.classList.remove('dragging');

            const endY = e.changedTouches[0].clientY;
            const diff = startY - endY;

            // Swipe up (diff > 0) = expand, swipe down (diff < 0) = collapse
            if (diff > 30) {
                modalContent.classList.add('expanded');
            } else if (diff < -30) {
                modalContent.classList.remove('expanded');
            }
        }, { passive: true });
    }

    // Close on outside click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
            resetModalExpansion();
            currentLocation = null;
        }
    });

    // Set default date to today
    const dateInput = document.getElementById('entryDate');
    dateInput.valueAsDate = new Date();

    // Submit entry
    entryForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const date = document.getElementById('entryDate').value;
        const bottles = parseInt(document.getElementById('bottleCount').value);

        if (!date || !bottles || bottles < 1) {
            alert('Παρακαλώ συμπληρώστε όλα τα πεδία');
            return;
        }

        try {
            const response = await fetch('/api/entries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUser.id,
                    locationId: currentLocation.id,
                    date,
                    bottles
                })
            });

            if (response.ok) {
                // Refresh data
                document.getElementById('bottleCount').value = '';
                await loadLocationEntries(currentLocation.id);
                await updateGrandTotal();

                // Refresh markers
                // map.eachLayer(layer => {
                //     if (layer instanceof L.Marker) {
                //         map.removeLayer(layer);
                //     }
                // });
                // await loadLocations();
                await refreshMarkers(); // Use the new refreshMarkers
            }
        } catch (error) {
            console.error('Error adding entry:', error);
            alert('Σφάλμα καταχώρησης');
        }
    });

    // Initialize Flatpickr with dark theme (no ugly native slider)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    flatpickr("#scheduleDate", {
        dateFormat: "Y-m-d",
        minDate: "today",
        defaultDate: tomorrow,
        locale: "gr",
        disableMobile: true // Force Flatpickr even on mobile
    });

    // Add schedule button
    document.getElementById('addScheduleBtn').addEventListener('click', async () => {
        const date = document.getElementById('scheduleDate').value;
        if (!date) {
            alert('Επιλέξτε ημερομηνία');
            return;
        }

        try {
            const response = await fetch('/api/schedules', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUser.id,
                    locationId: currentLocation.id,
                    date
                })
            });

            const data = await response.json();
            if (response.ok) {
                await loadLocationSchedules(currentLocation.id);
            } else {
                alert(data.error || 'Σφάλμα');
            }
        } catch (error) {
            console.error('Error adding schedule:', error);
            alert('Σφάλμα');
        }
    });
}

async function openLocationModal(location) {
    currentLocation = location;

    document.getElementById('locationName').textContent = location.name;
    document.getElementById('entryModal').classList.add('active');

    // Set Google Maps navigation link
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`;
    document.getElementById('navigateBtn').href = mapsUrl;

    // Set operating hours (default or location-specific)
    const hours = location.hours || 'Δευ-Σαβ 10:00-16:40';
    document.getElementById('locationHours').textContent = 'Ώρες: ' + hours;

    await loadLocationEntries(location.id);
    await loadLocationSchedules(location.id);
}

async function loadLocationEntries(locationId) {
    try {
        const response = await fetch(`/api/entries/${locationId}`);
        const data = await response.json();

        document.getElementById('locationTotal').textContent = data.total.toLocaleString('el-GR');

        const entriesList = document.getElementById('entriesList');

        if (data.entries.length === 0) {
            entriesList.innerHTML = '<p class="empty-message">Δεν υπάρχουν καταχωρήσεις</p>';
            return;
        }

        entriesList.innerHTML = data.entries.slice(0, 10).map(entry => {
            const isOwner = entry.userId === currentUser.id;
            return `
      <div class="entry-item" data-id="${entry.id}">
        <div class="entry-info">
          <span class="entry-user">${entry.firstName} ${entry.lastName}</span>
          <span class="entry-date">${new Date(entry.date).toLocaleDateString('el-GR')}</span>
        </div>
        <div class="entry-right">
          <span class="entry-bottles">${entry.bottles}</span>
          ${isOwner ? `
            <button class="entry-btn edit-btn" onclick="editEntry(${entry.id}, ${entry.bottles})">✎</button>
            <button class="entry-btn delete-btn" onclick="deleteEntry(${entry.id})">✕</button>
          ` : ''}
        </div>
      </div>
    `;
        }).join('');
    } catch (error) {
        console.error('Error loading entries:', error);
    }
}

async function editEntry(entryId, currentBottles) {
    const newBottles = prompt('Νέος αριθμός μπουκαλιών:', currentBottles);

    if (newBottles === null) return; // Cancelled

    const bottles = parseInt(newBottles);
    if (isNaN(bottles) || bottles < 0) {
        alert('Μη έγκυρος αριθμός');
        return;
    }

    try {
        const response = await fetch(`/api/entries/${entryId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                bottles,
                userId: currentUser.id
            })
        });

        if (response.ok) {
            await loadLocationEntries(currentLocation.id);
            await refreshMarkers();
            await updateGrandTotal();
        } else {
            const data = await response.json();
            alert(data.error || 'Σφάλμα ενημέρωσης');
        }
    } catch (error) {
        console.error('Error updating entry:', error);
        alert('Σφάλμα ενημέρωσης');
    }
}

async function deleteEntry(entryId) {
    if (!confirm('Διαγραφή καταχώρησης;')) return;

    try {
        const response = await fetch(`/api/entries/${entryId}?userId=${currentUser.id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await loadLocationEntries(currentLocation.id);
            await refreshMarkers();
            await updateGrandTotal();
        } else {
            const data = await response.json();
            alert(data.error || 'Σφάλμα διαγραφής');
        }
    } catch (error) {
        console.error('Error deleting entry:', error);
        alert('Σφάλμα διαγραφής');
    }
}

async function refreshMarkers() {
    await loadLocations();
}

async function loadLocationSchedules(locationId) {
    try {
        const response = await fetch(`/api/schedules/${locationId}`);
        const data = await response.json();
        const schedules = data.schedules;
        const today = data.today; // YYYY-MM-DD

        const schedulesList = document.getElementById('schedulesList');

        if (schedules.length === 0) {
            schedulesList.innerHTML = '<p class="empty-message">Κανείς δεν έχει προγραμματίσει</p>';
            return;
        }

        // Split into Upcoming (>= Today) and History (< Today)
        const upcoming = schedules.filter(s => s.date >= today).reverse(); // Show closest date first
        const history = schedules.filter(s => s.date < today); // Already sorted DESC

        let html = '';

        // Upcoming Section
        if (upcoming.length > 0) {
            html += upcoming.map(schedule => {
                const isOwner = schedule.userId === currentUser.id;
                const dateStr = new Date(schedule.date).toLocaleDateString('el-GR');
                const isCompleted = schedule.completed === 1;

                return `
                  <div class="schedule-item">
                    <div class="schedule-info">
                      <span class="schedule-user">
                        ${schedule.firstName} ${schedule.lastName}
                        ${isCompleted ? `<span class="status-icon status-completed" title="Ολοκληρώθηκε">✓</span>` : ''}
                      </span>
                      <span class="schedule-date">${dateStr}</span>
                    </div>
                    ${isOwner ? `<button class="entry-btn delete-btn" onclick="deleteSchedule(${schedule.id})">✕</button>` : ''}
                  </div>
                `;
            }).join('');
        } else {
            html += '<p class="empty-message">Δεν υπάρχουν μελλοντικά ραντεβού</p>';
        }

        // History Section (Logs)
        if (history.length > 0) {
            html += `
              <div class="schedule-history-section">
                <span class="history-label">Ιστορικό</span>
                ${history.map(schedule => {
                const dateStr = new Date(schedule.date).toLocaleDateString('el-GR');
                const isCompleted = schedule.completed === 1;

                return `
                      <div class="schedule-item history-item">
                        <div class="schedule-info">
                          <span class="schedule-user">
                            ${schedule.firstName} ${schedule.lastName}
                          </span>
                          <span class="schedule-status-row" style="display:flex; align-items:center;">
                             ${isCompleted
                        ? `<span class="status-icon status-completed">✓</span><span class="schedule-bottles">(${schedule.bottles} μπουκάλια)</span>`
                        : `<span class="status-icon status-missed">✕</span><span class="schedule-bottles">(Δεν πήγε)</span>`
                    }
                          </span>
                        </div>
                        <span class="schedule-date">${dateStr}</span>
                      </div>
                    `;
            }).join('')}
              </div>
            `;
        }

        schedulesList.innerHTML = html;

    } catch (error) {
        console.error('Error loading schedules:', error);
    }
}

async function deleteSchedule(scheduleId) {
    if (!confirm('Ακύρωση προγραμματισμού;')) return;

    try {
        const response = await fetch(`/api/schedules/${scheduleId}?userId=${currentUser.id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            await loadLocationSchedules(currentLocation.id);
        } else {
            const data = await response.json();
            alert(data.error || 'Σφάλμα');
        }
    } catch (error) {
        console.error('Error deleting schedule:', error);
        alert('Σφάλμα');
    }
}
