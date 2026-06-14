/**
 * Giải Cứu Thực Phẩm Dư Thừa - Ứng dụng chính
 * Quản lý danh sách thực phẩm, bản đồ Leaflet và thống kê (Supabase Integration)
 */

const SUPABASE_URL = 'https://vxbspdlvieiytmltjaqy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4YnNwZGx2aWVpeXRtbHRqYXF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ3OTQsImV4cCI6MjA5Njk5MDc5NH0.934_tDKj7MqrAbTy6N-INRuXAsKvScP0aYTezK7tfgA';

// Khởi tạo client Supabase
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const CO2_PER_KG = 2.5;

let mainMap = null;
let storeMap = null;
let mapMarkers = [];
let userMarker = null;

// ==========================================
// MAPPERS (Ánh xạ dữ liệu giữa Database và Frontend)
// ==========================================

function mapListingFromDb(dbItem) {
  if (!dbItem) return null;
  return {
    id: dbItem.id,
    storeName: dbItem.store_name,
    foodName: dbItem.food_name,
    quantity: parseFloat(dbItem.quantity),
    originalPrice: parseInt(dbItem.original_price),
    rescuePrice: parseInt(dbItem.rescue_price),
    isFree: dbItem.is_free,
    expiryHours: parseInt(dbItem.expiry_hours),
    lat: parseFloat(dbItem.lat),
    lng: parseFloat(dbItem.lng),
    city: dbItem.city,
    claimed: dbItem.claimed,
    createdAt: new Date(dbItem.created_at).getTime()
  };
}

function mapListingToDb(item) {
  if (!item) return null;
  return {
    store_name: item.storeName,
    food_name: item.foodName,
    quantity: parseFloat(item.quantity) || 1,
    original_price: parseInt(item.originalPrice) || 0,
    rescue_price: item.isFree ? 0 : (parseInt(item.rescuePrice) || 0),
    is_free: !!item.isFree,
    expiry_hours: parseInt(item.expiryHours) || 4,
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lng),
    city: item.city || '',
    claimed: !!item.claimed
  };
}

function mapActivityFromDb(dbItem) {
  if (!dbItem) return null;
  return {
    type: dbItem.type,
    message: dbItem.message,
    time: new Date(dbItem.created_at).getTime()
  };
}

// ==========================================
// DATA SEEDING (Tạo dữ liệu mẫu ban đầu nếu DB trống)
// ==========================================


// ==========================================
// DATABASE OPERATIONS (Các thao tác cơ sở dữ liệu)
// ==========================================

/** Lấy tất cả danh sách thực phẩm */
async function getAllListings() {
  const { data, error } = await supabaseClient
    .from('listings')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Lỗi lấy danh sách món ăn từ Supabase:', error);
    return [];
  }
  return data.map(mapListingFromDb);
}

/** Lấy listing theo ID */
async function getListingById(id) {
  const { data, error } = await supabaseClient
    .from('listings')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Lỗi lấy món ăn theo ID từ Supabase:', error);
    return null;
  }
  return mapListingFromDb(data);
}

/** Thêm listing mới */
async function createListing(data) {
  const dbItem = mapListingToDb(data);
  const { data: inserted, error } = await supabaseClient
    .from('listings')
    .insert([dbItem])
    .select()
    .single();

  if (error) {
    console.error('Lỗi thêm món ăn mới vào Supabase:', error);
    return null;
  }
  const newListing = mapListingFromDb(inserted);
  await addActivity('add', `Thêm món "${newListing.foodName}" từ ${newListing.storeName}`);
  return newListing;
}

/** Cập nhật listing theo ID */
async function updateListing(id, data) {
  const dbUpdates = {};
  if (data.storeName !== undefined) dbUpdates.store_name = data.storeName;
  if (data.foodName !== undefined) dbUpdates.food_name = data.foodName;
  if (data.quantity !== undefined) dbUpdates.quantity = parseFloat(data.quantity);
  if (data.originalPrice !== undefined) dbUpdates.original_price = parseInt(data.originalPrice);
  if (data.rescuePrice !== undefined) dbUpdates.rescue_price = data.isFree ? 0 : parseInt(data.rescuePrice);
  if (data.isFree !== undefined) dbUpdates.is_free = !!data.isFree;
  if (data.expiryHours !== undefined) dbUpdates.expiry_hours = parseInt(data.expiryHours);
  if (data.lat !== undefined) dbUpdates.lat = parseFloat(data.lat);
  if (data.lng !== undefined) dbUpdates.lng = parseFloat(data.lng);
  if (data.city !== undefined) dbUpdates.city = data.city;
  if (data.claimed !== undefined) dbUpdates.claimed = !!data.claimed;

  const { data: updated, error } = await supabaseClient
    .from('listings')
    .update(dbUpdates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Lỗi cập nhật món ăn trên Supabase:', error);
    return null;
  }
  return mapListingFromDb(updated);
}

/** Xóa listing theo ID */
async function deleteListing(id) {
  const item = await getListingById(id);
  if (!item) return false;

  const { error } = await supabaseClient
    .from('listings')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Lỗi xóa món ăn trên Supabase:', error);
    return false;
  }
  await addActivity('delete', `Xóa món "${item.foodName}" khỏi danh sách`);
  return true;
}

/** Lấy thống kê tổng hợp (Từ view hoặc tính toán phía client như fallback) */
async function getStats() {
  try {
    const { data, error } = await supabaseClient
      .from('dashboard_stats')
      .select('*')
      .single();

    const { data: activitiesData, error: actError } = await supabaseClient
      .from('activities')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (actError) throw actError;

    let statsData = {};

    if (error) {
      console.warn('Không thể truy vấn dashboard_stats view, chuyển sang tính toán client-side:', error);
      // Fallback: Tự tính từ bảng listings
      const { data: allClaimed, error: claimError } = await supabaseClient
        .from('listings')
        .select('*')
        .eq('claimed', true);

      if (claimError) throw claimError;

      let mealsSaved = 0;
      let moneySaved = 0;
      let co2Reduced = 0;
      let foodKg = 0;

      allClaimed.forEach(item => {
        const qty = parseFloat(item.quantity) || 0;
        const orig = parseInt(item.original_price) || 0;
        const resc = parseInt(item.rescue_price) || 0;

        mealsSaved += 1;
        foodKg += qty;
        co2Reduced += qty * CO2_PER_KG;
        if (item.is_free) {
          moneySaved += orig;
        } else {
          moneySaved += Math.max(0, orig - resc);
        }
      });

      statsData = { meals_saved: mealsSaved, money_saved: moneySaved, co2_reduced: co2Reduced, food_kg: foodKg };
    } else {
      statsData = data;
    }

    return {
      mealsSaved: statsData.meals_saved || 0,
      moneySaved: statsData.money_saved || 0,
      co2Reduced: parseFloat(statsData.co2_reduced) || 0,
      foodKg: parseFloat(statsData.food_kg) || 0,
      activities: (activitiesData || []).map(mapActivityFromDb)
    };
  } catch (e) {
    console.error('Lỗi lấy thống kê từ Supabase:', e);
    return {
      mealsSaved: 0,
      moneySaved: 0,
      co2Reduced: 0,
      foodKg: 0,
      activities: []
    };
  }
}

/** Lấy dữ liệu thống kê theo tuần */
async function getWeeklyStats() {
  const labels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const meals = [0, 0, 0, 0, 0, 0, 0];
  const co2 = [0, 0, 0, 0, 0, 0, 0];

  try {
    const now = new Date();
    const currentDay = now.getDay();
    const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - distanceToMonday);
    startOfWeek.setHours(0, 0, 0, 0);

    const { data, error } = await supabaseClient
      .from('listings')
      .select('quantity, created_at')
      .eq('claimed', true)
      .gte('created_at', startOfWeek.toISOString());

    if (error) throw error;

    data.forEach(item => {
      const itemDate = new Date(item.created_at);
      const day = itemDate.getDay(); // 0: CN, 1: T2, ..., 6: T7
      const dayIndex = day === 0 ? 6 : day - 1; // Map về T2-CN (0-6)
      if (dayIndex >= 0 && dayIndex < 7) {
        meals[dayIndex] += 1;
        co2[dayIndex] += calculateCO2(parseFloat(item.quantity));
      }
    });
  } catch (e) {
    console.error('Lỗi tính toán thống kê tuần từ Supabase:', e);
  }

  return { labels, meals, co2 };
}

/** Tính lượng CO2 giảm phát thải */
function calculateCO2(quantityKg) {
  return quantityKg * CO2_PER_KG;
}

/** Thêm hoạt động mới */
async function addActivity(type, message) {
  try {
    const { error } = await supabaseClient
      .from('activities')
      .insert([{ type, message }]);
    if (error) throw error;
  } catch (e) {
    console.error('Lỗi ghi nhật ký hoạt động:', e);
  }
}

/** Cứu thực phẩm - Đánh dấu và ghi log */
async function claimFood(id) {
  const listing = await getListingById(id);
  if (!listing) {
    showToast('Không tìm thấy món ăn!', 'error');
    return false;
  }
  if (listing.claimed) {
    showToast('Món này đã được cứu rồi!', 'warning');
    return false;
  }

  const updated = await updateListing(id, { claimed: true });
  if (!updated) {
    showToast('Có lỗi xảy ra khi cứu thực phẩm!', 'error');
    return false;
  }

  await addActivity('claim', `Đã cứu "${listing.foodName}" từ ${listing.storeName}`);
  showToast(`🎉 Cứu thành công "${listing.foodName}"!`, 'success');
  return true;
}

// ==========================================
// UTILS & FORMATTING (Các hàm tiện ích)
// ==========================================

/** Định dạng tiền VND */
function formatCurrency(amount) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND'
  }).format(amount);
}

/** Định dạng thời gian tương đối */
function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  if (hours < 24) return `${hours} giờ trước`;
  return `${days} ngày trước`;
}

/** Hiển thị thông báo Toast */
function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.success}</span>
    <span class="toast-message">${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==========================================
// MAP & MAP MARKERS (Leaflet Map logic)
// ==========================================

/** Tạo icon marker thực phẩm */
function createFoodMarkerIcon(emoji = '🍱', isUser = false) {
  const userClass = isUser ? ' food-marker-user' : '';
  return L.divIcon({
    className: 'food-marker' + userClass,
    html: `<div class="food-marker-inner"><span class="food-marker-emoji">${emoji}</span></div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 44],
    popupAnchor: [0, -44]
  });
}

/** Tạo nội dung popup của marker */
function createPopupContent(listing) {
  const priceText = listing.isFree
    ? '<span class="text-amber-600 font-bold">🎁 MIỄN PHÍ</span>'
    : `<span class="popup-price">${formatCurrency(listing.rescuePrice)}</span>
       <span class="text-gray-400 line-through text-sm ml-1">${formatCurrency(listing.originalPrice)}</span>`;

  const claimBtn = listing.claimed
    ? '<button class="popup-btn" disabled style="background:#9ca3af">Đã được cứu</button>'
    : `<button class="popup-btn" onclick="handlePopupClaim('${listing.id}')">🌱 Cứu ngay</button>`;

  return `
    <div class="popup-food">
      <div class="store-name">🏪 ${listing.storeName}</div>
      <h3>${listing.foodName}</h3>
      <p class="text-sm text-gray-500 mb-2">${listing.quantity} kg · Hết hạn ${listing.expiryHours}h</p>
      <div>${priceText}</div>
      ${claimBtn}
    </div>
  `;
}

/** Xử lý click cứu thực phẩm từ popup bản đồ */
async function handlePopupClaim(id) {
  const success = await claimFood(id);
  if (success) {
    await refreshCurrentPage();
  }
}

/** Xóa toàn bộ marker khỏi bản đồ */
function clearMapMarkers() {
  mapMarkers.forEach(marker => {
    if (mainMap) mainMap.removeLayer(marker);
    if (storeMap) storeMap.removeLayer(marker);
  });
  mapMarkers = [];
}

/** Render một marker đơn lẻ */
function renderMapMarker(listing, mapInstance) {
  if (!mapInstance || !listing.lat || !listing.lng) return;

  const emojis = ['🍱', '🥗', '🍞', '🥐', '🍎', '🥪'];
  const emoji = emojis[Math.abs(listing.foodName.length) % emojis.length];
  const marker = L.marker([listing.lat, listing.lng], {
    icon: createFoodMarkerIcon(emoji)
  }).addTo(mapInstance);

  marker.bindPopup(createPopupContent(listing));
  mapMarkers.push(marker);
}

/** Render tất cả marker lên bản đồ */
async function renderMapMarkers(mapInstance, filterClaimed = false) {
  clearMapMarkers();
  const listings = await getAllListings();
  listings
    .filter(item => !filterClaimed || !item.claimed)
    .forEach(function renderSingleMarker(listing) {
      renderMapMarker(listing, mapInstance);
    });
}

/** Khởi tạo bản đồ chính index.html */
async function initMainMap(containerId, center = [16.0544, 108.2022], zoom = 6) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  if (mainMap) {
    mainMap.remove();
    mainMap = null;
  }

  mainMap = L.map(containerId).setView(center, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(mainMap);

  await renderMapMarkers(mainMap);
  return mainMap;
}

/** Khởi tạo bản đồ click vị trí store.html */
function initStoreMap(containerId, onLocationPick) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  if (storeMap) {
    storeMap.remove();
    storeMap = null;
  }

  storeMap = L.map(containerId).setView([21.0285, 105.8542], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19
  }).addTo(storeMap);

  let pickMarker = null;

  storeMap.on('click', function onMapClick(e) {
    const { lat, lng } = e.latlng;
    if (pickMarker) storeMap.removeLayer(pickMarker);
    pickMarker = L.marker([lat, lng], {
      icon: createFoodMarkerIcon('📍')
    }).addTo(storeMap);

    document.getElementById('inputLat').value = lat.toFixed(6);
    document.getElementById('inputLng').value = lng.toFixed(6);

    if (typeof onLocationPick === 'function') {
      onLocationPick(lat, lng);
    }
  });

  return storeMap;
}

/** Tìm vị trí hiện tại bằng định vị trình duyệt */
function locateUser(mapInstance) {
  if (!navigator.geolocation) {
    showToast('Trình duyệt không hỗ trợ định vị!', 'error');
    return;
  }

  showToast('Đang tìm vị trí của bạn...', 'info');

  navigator.geolocation.getCurrentPosition(
    function onGeoSuccess(position) {
      const { latitude, longitude } = position.coords;
      if (mapInstance) {
        mapInstance.setView([latitude, longitude], 14);
        if (userMarker) mapInstance.removeLayer(userMarker);
        userMarker = L.marker([latitude, longitude], {
          icon: createFoodMarkerIcon('📍', true)
        }).addTo(mapInstance).bindPopup('📍 Vị trí của bạn').openPopup();
      }
      showToast('Đã tìm thấy vị trí của bạn!', 'success');
    },
    function onGeoError() {
      showToast('Không thể lấy vị trí. Vui lòng bật GPS!', 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ==========================================
// CARD & PAGE RENDERING (Hiển thị thẻ & Giao diện)
// ==========================================

/** Render danh sách thẻ món ăn */
async function renderFoodCards(containerId, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const listings = await getAllListings();
  const showClaimed = options.showClaimed !== false;
  const filtered = showClaimed ? listings : listings.filter(l => !l.claimed);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🍽️</div>
        <p class="font-semibold text-gray-600">Chưa có thực phẩm nào</p>
        <p class="text-sm mt-2">Hãy thêm món từ trang Cửa hàng!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(listing => {
    const claimedClass = listing.claimed ? ' claimed' : '';
    const badge = listing.isFree
      ? '<span class="food-card-badge badge-free">🎁 Miễn phí</span>'
      : `<span class="food-card-badge badge-discount">💚 Giảm ${Math.round((1 - listing.rescuePrice / listing.originalPrice) * 100)}%</span>`;
    const expiringBadge = listing.expiryHours <= 3
      ? '<span class="food-card-badge badge-expiring ml-1">⏰ Sắp hết hạn</span>'
      : '';

    const priceHtml = listing.isFree
      ? '<span class="food-card-price">Miễn phí</span>'
      : `<span class="food-card-price">${formatCurrency(listing.rescuePrice)}</span>
         <span class="food-card-price-original ml-2">${formatCurrency(listing.originalPrice)}</span>`;

    const btnHtml = listing.claimed
      ? '<button class="btn-rescue" disabled>✅ Đã cứu</button>'
      : `<button class="btn-rescue" onclick="handleCardClaim('${listing.id}')">🌱 Cứu ngay</button>`;

    return `
      <div class="food-card${claimedClass} p-4 mb-4 animate-fade-in" data-id="${listing.id}">
        <div class="flex justify-between items-start mb-2">
          <div>
            <p class="text-xs font-semibold text-emerald-600">${listing.storeName}</p>
            <h3 class="font-bold text-gray-800 text-lg">${listing.foodName}</h3>
          </div>
          <div class="flex flex-wrap gap-1 justify-end">${badge}${expiringBadge}</div>
        </div>
        <p class="text-sm text-gray-500 mb-3">
          📍 ${listing.city || 'Việt Nam'} · ${listing.quantity} kg · Còn ${listing.expiryHours}h
        </p>
        <div class="flex justify-between items-center">
          <div>${priceHtml}</div>
          ${btnHtml}
        </div>
      </div>
    `;
  }).join('');
}

/** Xử lý click cứu thực phẩm từ thẻ danh sách */
async function handleCardClaim(id) {
  const success = await claimFood(id);
  if (success) {
    await refreshCurrentPage();
  }
}

/** Cập nhật số liệu Hero Stats ở Trang chủ */
async function updateHeroStats() {
  const listings = await getAllListings();
  const stats = await getStats();
  const available = listings.filter(l => !l.claimed).length;

  const elAvailable = document.getElementById('statAvailable');
  const elMeals = document.getElementById('statMeals');
  const elCo2 = document.getElementById('statCo2');
  const elStores = document.getElementById('statStores');

  if (elAvailable) elAvailable.textContent = available;
  if (elMeals) elMeals.textContent = stats.mealsSaved || 0;
  if (elCo2) elCo2.textContent = (stats.co2Reduced || 0).toFixed(1) + ' kg';
  if (elStores) {
    const stores = new Set(listings.map(l => l.storeName)).size;
    elStores.textContent = stores;
  }
}

/** Làm mới trang hiện tại khi có sự thay đổi */
async function refreshCurrentPage() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  if (path.includes('index') || path === '') {
    await renderFoodCards('foodList');
    if (mainMap) await renderMapMarkers(mainMap);
    await updateHeroStats();
  } else if (path.includes('store')) {
    await renderFoodCards('storeListings', { showClaimed: true });
  } else if (path.includes('admin')) {
    await renderAdminDashboard();
  }
}

/** Đặt class active cho navigation */
function setActiveNav(page) {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });
}

// ==========================================
// PAGE INITIALIZATIONS (Khởi tạo các trang)
// ==========================================

/** Khởi tạo index.html */
async function initIndexPage() {
  setActiveNav('index');
  await updateHeroStats();
  await renderFoodCards('foodList');

  setTimeout(async () => {
    await initMainMap('map', [16.0544, 108.2022], 6);
  }, 100);

  const locateBtn = document.getElementById('btnLocate');
  if (locateBtn) {
    locateBtn.addEventListener('click', () => locateUser(mainMap));
  }

  const filterBtn = document.getElementById('btnFilterAvailable');
  if (filterBtn) {
    let showAll = true;
    filterBtn.addEventListener('click', async () => {
      showAll = !showAll;
      await renderFoodCards('foodList', { showClaimed: showAll });
      filterBtn.textContent = showAll ? '👁️ Xem tất cả' : '✅ Chỉ còn hàng';
    });
  }
}

/** Khởi tạo store.html */
async function initStorePage() {
  setActiveNav('store');
  await renderFoodCards('storeListings', { showClaimed: true });

  setTimeout(() => {
    initStoreMap('storeMap');
  }, 100);

  const form = document.getElementById('storeForm');
  if (form) {
    form.addEventListener('submit', async function onFormSubmit(e) {
      e.preventDefault();

      const lat = parseFloat(document.getElementById('inputLat').value);
      const lng = parseFloat(document.getElementById('inputLng').value);

      if (isNaN(lat) || isNaN(lng)) {
        showToast('Vui lòng chọn vị trí trên bản đồ!', 'warning');
        return;
      }

      const isFree = document.getElementById('inputFree').checked;

      const created = await createListing({
        storeName: document.getElementById('inputStoreName').value.trim(),
        foodName: document.getElementById('inputFoodName').value.trim(),
        quantity: document.getElementById('inputQuantity').value,
        originalPrice: document.getElementById('inputOriginalPrice').value,
        rescuePrice: document.getElementById('inputRescuePrice').value,
        isFree,
        expiryHours: document.getElementById('inputExpiry').value,
        lat,
        lng,
        city: document.getElementById('inputCity').value.trim()
      });

      if (created) {
        showToast('✅ Đăng món thành công!', 'success');
        form.reset();
        document.getElementById('inputLat').value = '';
        document.getElementById('inputLng').value = '';
        await renderFoodCards('storeListings', { showClaimed: true });
      } else {
        showToast('❌ Đăng món thất bại!', 'error');
      }
    });
  }

  const freeCheckbox = document.getElementById('inputFree');
  const rescuePriceInput = document.getElementById('inputRescuePrice');
  if (freeCheckbox && rescuePriceInput) {
    freeCheckbox.addEventListener('change', () => {
      rescuePriceInput.disabled = freeCheckbox.checked;
      if (freeCheckbox.checked) rescuePriceInput.value = '0';
    });
  }
}

/** Khởi tạo admin.html */
async function renderAdminDashboard() {
  const stats = await getStats();
  const weekly = await getWeeklyStats();

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl('dashMeals', stats.mealsSaved || 0);
  setEl('dashMoney', formatCurrency(stats.moneySaved || 0));
  setEl('dashCo2', (stats.co2Reduced || 0).toFixed(1) + ' kg');
  setEl('dashFood', (stats.foodKg || 0).toFixed(1) + ' kg');

  renderActivityFeed(stats.activities || []);
  renderWeeklyChart(weekly);
}

/** Render danh sách nhật ký hoạt động */
function renderActivityFeed(activities) {
  const container = document.getElementById('activityFeed');
  if (!container) return;

  if (!activities.length) {
    container.innerHTML = `
      <div class="empty-state py-8">
        <p class="text-gray-400">Chưa có hoạt động nào</p>
      </div>
    `;
    return;
  }

  const icons = { claim: '🌱', add: '➕', delete: '🗑️' };
  container.innerHTML = activities.slice(0, 10).map(act => `
    <div class="activity-item">
      <div class="activity-dot"></div>
      <div>
        <p class="text-sm text-gray-700">
          <span class="mr-1">${icons[act.type] || '📌'}</span>${act.message}
        </p>
        <p class="activity-time">${formatRelativeTime(act.time)}</p>
      </div>
    </div>
  `).join('');
}

/** Render biểu đồ tuần bằng Chart.js */
function renderWeeklyChart(weekly) {
  const canvas = document.getElementById('weeklyChart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (window.weeklyChartInstance) {
    window.weeklyChartInstance.destroy();
  }

  window.weeklyChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: weekly.labels,
      datasets: [
        {
          label: 'Bữa ăn cứu được',
          data: weekly.meals,
          backgroundColor: 'rgba(5, 150, 105, 0.7)',
          borderColor: '#059669',
          borderWidth: 2,
          borderRadius: 8,
          yAxisID: 'y'
        },
        {
          label: 'CO₂ giảm (kg)',
          data: weekly.co2,
          type: 'line',
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderWidth: 3,
          tension: 0.4,
          fill: true,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { font: { family: 'Be Vietnam Pro', size: 12 } }
        }
      },
      scales: {
        y: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'Bữa ăn', font: { family: 'Be Vietnam Pro' } },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'CO₂ (kg)', font: { family: 'Be Vietnam Pro' } },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

async function initAdminPage() {
  setActiveNav('admin');
  await renderAdminDashboard();
}

// Khởi chạy ứng dụng dựa trên thuộc tính data-page của thẻ body
document.addEventListener('DOMContentLoaded', async function onDOMReady() {
  const page = document.body.dataset.page;
  if (page === 'index') await initIndexPage();
  else if (page === 'store') await initStorePage();
  else if (page === 'admin') await initAdminPage();
});
