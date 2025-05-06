// --- 1. YANDEX MAPS API AYARLARI ---
// !!! GÜVENLİK UYARISI: Kendi API anahtarınızı kullanın !!!
const YANDEX_API_KEY = 'b9dd1892-bda6-4f79-a7ba-6c81d0ec9a57';

// --- 2. SABİTLER VE BAŞLANGIÇ NOKTASI ---
const SIIRT_PTT_LOCATION = { coords: [37.9275, 41.9420], address: "Siirt PTT Müdürlüğü" }; // Yandex'te [lat, lon] formatında
const NUM_RANDOM_LOCATIONS = 11;

// Siirt Merkez Mahallelerini kabaca içeren sınırlayıcı kutu
const SIIRT_MERKEZ_BOUNDS = [37.920, 41.915, 37.945, 41.955]; // Yandex'te [minLat, minLon, maxLat, maxLon]

// --- 3. GLOBAL DEĞİŞKENLER ---
let map;
let markers = [];
let routes = [];
// locationData formatı: { coords: [lat, lon], address: "...", originalIndex: number }
let locationData = [];
const locationsListContainer = document.getElementById('locations-list');
const routeInfoDiv = document.getElementById('route-info');
const loadingIndicator = document.getElementById('loading-indicator');
const generateBtn = document.getElementById('generate-points-btn');
const calculateBtn = document.getElementById('calculate-route-btn');

// --- 4. HARİTA İLK AYARLARI ---
function initializeMap() {
    ymaps.ready(() => {
        map = new ymaps.Map('map', {
            center: SIIRT_PTT_LOCATION.coords,
            zoom: 13,
            controls: ['zoomControl', 'rulerControl', 'typeSelector']
        });
        
        // Başlangıç noktasını ekle
        const startPlacemark = new ymaps.Placemark(SIIRT_PTT_LOCATION.coords, {
            balloonContent: SIIRT_PTT_LOCATION.address,
            iconCaption: 'PTT'
        }, {
            preset: 'islands#greenDotIconWithCaption'
        });
        
        map.geoObjects.add(startPlacemark);
        
        // UI kontrollerini etkinleştir
        generateBtn.disabled = false;
    });
}

// --- 5. SINIRLAR İÇİNDE RASTGELE NOKTA ÜRETME ---
function generateRandomPointsInBounds(count, bounds) {
    const points = [];
    const [minLat, minLon, maxLat, maxLon] = bounds;
    for (let i = 0; i < count; i++) {
        const lat = minLat + Math.random() * (maxLat - minLat);
        const lon = minLon + Math.random() * (maxLon - minLon);
        points.push([lat, lon]); // Yandex'te [lat, lon] formatında
    }
    return points;
}

// --- 6. REVERSE GEOCODING (Yandex ile Adres Bulma) ---
async function reverseGeocode(coords) {
    const [lat, lon] = coords;
    return new Promise((resolve) => {
        ymaps.geocode([lat, lon]).then(res => {
            const firstGeoObject = res.geoObjects.get(0);
            if (firstGeoObject) {
                const address = firstGeoObject.getAddressLine();
                resolve(address || `Adres bulunamadı (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
            } else {
                resolve(`Adres bulunamadı (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
            }
        }).catch(error => {
            console.error('Reverse Geocoding Hatası:', error);
            resolve(`Hata (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
        });
    });
}

// --- 7. NOKTALARI GÖSTERME VE ADRESLERİ ALMA ---
async function displayLocationsAndGetAddresses(startLocation, randomPoints) {
    setLoading(true, "Noktalar ve adresler yükleniyor...");
    locationData = []; // Önceki verileri temizle
    locationsListContainer.innerHTML = '<h4>Bulunan Adresler (Sırasız):</h4>';
    const unorderedList = document.createElement('ul');
    locationsListContainer.appendChild(unorderedList);
    routeInfoDiv.innerHTML = '';
    calculateBtn.disabled = true;

    // Önceki işaretçileri temizle
    markers.forEach(marker => map.geoObjects.remove(marker));
    markers = [];
    
    // Önceki rotaları temizle
    routes.forEach(route => map.geoObjects.remove(route));
    routes = [];

    // Rastgele noktalar için adresleri bul ve göster
    let pointCounter = 1;
    for (const coords of randomPoints) {
        const address = await reverseGeocode(coords);
        // Koordinat, adres ve orijinal sıra numarasını sakla
        locationData.push({
            coords: coords,
            address: address,
            originalIndex: pointCounter
        });

        const marker = new ymaps.Placemark(coords, {
            balloonContent: `Nokta ${pointCounter}: ${address}`,
            iconCaption: `${pointCounter}`
        }, {
            preset: 'islands#blueCircleDotIconWithCaption'
        });
        
        map.geoObjects.add(marker);
        markers.push(marker);

        // Listeye adresi ve orijinal index'i ekle (sırasız olarak)
        const listItem = document.createElement('li');
        listItem.textContent = `Nokta ${pointCounter}: ${address}`;
        unorderedList.appendChild(listItem);
        pointCounter++;
    }

    if (locationData.length > 0) {
        calculateBtn.disabled = false;
    }
    setLoading(false);
}

// --- 8. KUŞ UÇUŞU MESAFE HESAPLAMA ---
function haversineDistance(coords1, coords2) {
    // Yandex'te [lat, lon] formatında
    const [lat1, lon1] = coords1;
    const [lat2, lon2] = coords2;
    
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + 
              Math.cos(lat1 * Math.PI / 180) * 
              Math.cos(lat2 * Math.PI / 180) * 
              Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// --- 9. EN YAKIN KOMŞU ALGORİTMASI ---
function nearestNeighborTSP(startLocation, points) {
    let currentLocation = startLocation;
    let orderedRoute = [startLocation];
    let remainingPoints = points.map(p => ({ ...p, visited: false }));

    // Ziyaret edilecek nokta sayısı kadar dön
    const numPointsToVisit = remainingPoints.length;
    for(let visitCount = 0; visitCount < numPointsToVisit; visitCount++){
        let nearestPoint = null;
        let nearestDistance = Infinity;
        let nearestInternalIndex = -1;

        for (let i = 0; i < remainingPoints.length; i++) {
            if (!remainingPoints[i].visited) {
                const distance = haversineDistance(currentLocation.coords, remainingPoints[i].coords);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestPoint = remainingPoints[i];
                    nearestInternalIndex = i;
                }
            }
        }

        if (nearestPoint) {
            nearestPoint.visited = true;
            orderedRoute.push(nearestPoint);
            currentLocation = nearestPoint;
        } else {
            if(remainingPoints.filter(p => !p.visited).length === 0) break;
            console.error("Hata: Ziyaret edilmemiş en yakın nokta bulunamadı!");
            break;
        }
    }

    orderedRoute.push(startLocation); // Başa dön
    return orderedRoute;
}

// --- 10. YOL AĞI ÜZERİNDEN ROTA ÇİZME VE BİLGİ HESAPLAMA ---
async function drawRouteAndCalculateInfo(orderedRoute) {
    setLoading(true, "Yol ağı üzerinden rota çiziliyor...");
    calculateBtn.disabled = true;
    generateBtn.disabled = true;
    
    // Önceki rotaları temizle
    routes.forEach(route => map.geoObjects.remove(route));
    routes = [];

    let totalDistance = 0;
    let totalDuration = 0;
    const segmentPromises = [];
    const totalSegments = orderedRoute.length - 1;

    // Her segment için rota hesapla
    for (let i = 0; i < totalSegments; i++) {
        const startPoint = orderedRoute[i].coords;
        const endPoint = orderedRoute[i + 1].coords;
        
        const progress = totalSegments <= 1 ? 0.5 : i / (totalSegments - 1);
        const segmentColor = interpolateColor(0, 255, 0, 255, 0, 0, progress);
        
        segmentPromises.push(calculateRoute(startPoint, endPoint, i, segmentColor));
    }

    // Tüm segment hesaplamalarını bekle
    const segmentResults = await Promise.all(segmentPromises);
    segmentResults.forEach(result => {
        if (result) {
            totalDuration += result.duration;
            totalDistance += result.distance;
        }
    });

    const durationMinutes = (totalDuration / 60).toFixed(1);
    const distanceKm = (totalDistance / 1000).toFixed(1);
    routeInfoDiv.innerHTML = `En Yakın Komşu Rota: Yaklaşık <strong>${durationMinutes} dakika</strong>, <strong>${distanceKm} km</strong> (Yol Ağı Üzerinden)`;

    displayOrderedRouteList(orderedRoute);

    setLoading(false);
    calculateBtn.disabled = false;
    generateBtn.disabled = false;
}

// Yandex Maps ile segment için rota hesaplama
async function calculateRoute(from, to, segmentIndex, segmentColor) {
    return new Promise((resolve) => {
        const multiRoute = new ymaps.multiRouter.MultiRoute({
            referencePoints: [from, to],
            params: {
                routingMode: 'auto'  // Araba ile yolculuk
            }
        }, {
            boundsAutoApply: false,
            wayPointVisible: false,
            routeActiveStrokeWidth: 5,
            routeActiveStrokeColor: segmentColor,
            routeActiveStrokeStyle: 'solid',
            routeActivePedestrianSegmentStrokeStyle: 'solid'
        });
        
        multiRoute.model.events.add('requestsuccess', function() {
            // Rota verileri
            const activeRoute = multiRoute.getActiveRoute();
            if (activeRoute) {
                const duration = activeRoute.properties.get('duration').value;
                const distance = activeRoute.properties.get('distance').value;
                map.geoObjects.add(multiRoute);
                routes.push(multiRoute);
                resolve({ duration, distance });
            } else {
                console.warn(`Segment ${segmentIndex + 1} için rota bulunamadı.`);
                resolve({ duration: 0, distance: 0 });
            }
        });
        
        multiRoute.model.events.add('requestfail', function(error) {
            console.error(`Rota segmenti ${segmentIndex + 1} alınamadı:`, error);
            resolve({ duration: 0, distance: 0 });
        });
    });
}

// Renk Geçişi Fonksiyonu
function interpolateColor(r1, g1, b1, r2, g2, b2, progress) {
    const r = Math.round(r1 + (r2 - r1) * progress);
    const g = Math.round(g1 + (g2 - g1) * progress);
    const b = Math.round(b1 + (b2 - b1) * progress);
    const toHex = (c) => c.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// --- 11. Sıralı Listeyi Gösterme ---
function displayOrderedRouteList(orderedRoute) {
    locationsListContainer.innerHTML = '<h4>En Yakın Komşu Rota Sırası:</h4>';
    const orderedListElement = document.createElement('ol');

    orderedRoute.forEach((location, index) => {
        const listItem = document.createElement('li');
        let label = "";
        let originalIndexInfo = "";

        if (location.originalIndex !== undefined) {
            originalIndexInfo = ` (Nokta ${location.originalIndex})`;
        }

        if (index === 0) {
            label = "Başlangıç: ";
        } else if (index === orderedRoute.length - 1) {
            label = `Bitiş (${index}): `;
        } else {
            label = `${index}. Durak${originalIndexInfo}: `;
        }
        listItem.textContent = `${label}${location.address}`;
        orderedListElement.appendChild(listItem);
    });

    locationsListContainer.appendChild(orderedListElement);
}

// --- 12. Yükleme Göstergesi ---
function setLoading(isLoading, message = "İşlem yapılıyor...") {
    loadingIndicator.textContent = message;
    loadingIndicator.style.display = isLoading ? 'block' : 'none';
}

// --- 13. OLAY DİNLEYİCİLERİ VE BAŞLATMA ---
generateBtn.disabled = true; // Harita yüklenene kadar devre dışı bırak
calculateBtn.disabled = true;

generateBtn.addEventListener('click', () => {
    const randomPoints = generateRandomPointsInBounds(NUM_RANDOM_LOCATIONS, SIIRT_MERKEZ_BOUNDS);
    displayLocationsAndGetAddresses(SIIRT_PTT_LOCATION, randomPoints);
});

calculateBtn.addEventListener('click', () => {
    if (locationData.length > 0) {
        const orderedRoute = nearestNeighborTSP(SIIRT_PTT_LOCATION, locationData);
        drawRouteAndCalculateInfo(orderedRoute);
    } else {
        alert("Önce gösterilecek noktalar üretilmelidir.");
    }
});

// Sayfa yüklendiğinde haritayı başlat (Yandex API yüklendikten sonra)
function init() {
    // Scripti sayfaya ekle
    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${YANDEX_API_KEY}&lang=tr_TR`;
    script.async = true;
    script.onload = initializeMap;
    document.body.appendChild(script);
}

// Sayfa yüklendikten sonra başlat
window.onload = init;