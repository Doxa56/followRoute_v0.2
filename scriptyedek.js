// --- 1. MAPBOX TOKEN'INIZI BURAYA GİRİN ---
// !!! GÜVENLİK UYARISI: Lütfen hesabınızdan YENİ bir token oluşturup kullanın !!!
mapboxgl.accessToken = 'pk.eyJ1IjoiZG94YTU2IiwiYSI6ImNtYTZraDQzNjAyMG0yanF6NmgwbXN0MDUifQ.V70oJ3N2-PALS12i959MaQ';

// --- 2. SABİTLER VE BAŞLANGIÇ NOKTASI ---
const SIIRT_PTT_LOCATION = { coords: [41.9420, 37.9275], address: "Siirt PTT Müdürlüğü" };
const NUM_RANDOM_LOCATIONS = 11; // Toplam 12 nokta

const SIIRT_MERKEZ_BOUNDS = [41.920, 37.910, 41.970, 37.950];

// --- 3. GLOBAL DEĞİŞKENLER ---
let map;
let markers = [];
let routeLayerId = 'nn-route-layer'; // Tek katman ID'si
let locationData = []; // Format: [{ coords: [lon, lat], address: "...", originalIndex: number }]
const locationsListContainer = document.getElementById('locations-list');
const routeInfoDiv = document.getElementById('route-info');
const loadingIndicator = document.getElementById('loading-indicator');
const generateBtn = document.getElementById('generate-points-btn');
const calculateBtn = document.getElementById('calculate-route-btn');

// --- 4. HARİTA İLK AYARLARI ---
function initializeMap() {
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: SIIRT_PTT_LOCATION.coords,
        zoom: 12.8
    });
    map.addControl(new mapboxgl.NavigationControl());
}

// --- 5. SINIRLAR İÇİNDE RASTGELE NOKTA ÜRETME ---
function generateRandomPointsInBounds(count, bounds) {
    const points = [];
    const [minLon, minLat, maxLon, maxLat] = bounds;
    for (let i = 0; i < count; i++) {
        const lon = minLon + Math.random() * (maxLon - minLon);
        const lat = minLat + Math.random() * (maxLat - minLat);
        points.push([lon, lat]);
    }
    return points;
}

// --- 6. REVERSE GEOCODING ---
async function reverseGeocode(coords) {
    const [lon, lat] = coords;
    const apiUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?limit=1&language=tr&access_token=${mapboxgl.accessToken}`;
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Geocoding yapılamadı');
        const data = await response.json();
        return data.features?.[0]?.place_name || `Adres bulunamadı (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
    } catch (error) {
        console.error('Reverse Geocoding Hatası:', error);
        return `Hata (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
    }
}

// --- 7. NOKTALARI GÖSTERME VE ADRESLERİ ALMA ---
async function displayLocationsAndGetAddresses(startLocation, randomPoints) {
    setLoading(true, "Noktalar ve adresler yükleniyor...");
    locationData = [];
    locationsListContainer.innerHTML = '<h4>Bulunan Adresler (Sırasız):</h4>';
    const unorderedList = document.createElement('ul');
    locationsListContainer.appendChild(unorderedList);
    routeInfoDiv.innerHTML = '';
    calculateBtn.disabled = true;

    markers.forEach(marker => marker.remove());
    markers = [];
    removeSingleRouteLayer(); // Önceki tek rotayı temizle

    const startMarker = new mapboxgl.Marker({ color: '#28a745' })
        .setLngLat(startLocation.coords)
        .setPopup(new mapboxgl.Popup().setText(startLocation.address))
        .addTo(map);
    markers.push(startMarker);

    let pointCounter = 1;
    for (const coords of randomPoints) {
        const address = await reverseGeocode(coords);
        locationData.push({
            coords: coords,
            address: address,
            originalIndex: pointCounter
        });
        const marker = new mapboxgl.Marker({ color: '#007bff' })
            .setLngLat(coords)
            .setPopup(new mapboxgl.Popup({ offset: 25 }).setText(`Nokta ${pointCounter}: ${address}`))
            .addTo(map);
        markers.push(marker);
        const listItem = document.createElement('li');
        listItem.textContent = `Nokta ${pointCounter}: ${address}`;
        unorderedList.appendChild(listItem);
        pointCounter++;
    }
    if (locationData.length > 0) calculateBtn.disabled = false;
    setLoading(false);
}

// --- 8. KUŞ UÇUŞU MESAFE HESAPLAMA ---
function haversineDistance(coords1, coords2) {
    const R = 6371; // km
    const dLat = (coords2[1] - coords1[1]) * Math.PI / 180;
    const dLon = (coords2[0] - coords1[0]) * Math.PI / 180;
    const lat1 = coords1[1] * Math.PI / 180;
    const lat2 = coords2[1] * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// --- 9. EN YAKIN KOMŞU ALGORİTMASI ---
function nearestNeighborTSP(startLocation, points) {
    let currentLocation = startLocation;
    let orderedRoute = [startLocation];
    let remainingPoints = points.map(p => ({ ...p, visited: false }));
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
                    nearestInternalIndex = i; // Bu index'i kullanmıyoruz ama kalsın
                }
            }
        }
        if (nearestPoint) {
            nearestPoint.visited = true; // İşaretle
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

// --- 10. TÜM SIRALI ROTA İÇİN YOL ÇİZME VE BİLGİ HESAPLAMA (GÜNCELLENDİ) ---
async function calculateAndDrawNNRoute(orderedRoute) {
    setLoading(true, "En Yakın Komşu sırasına göre yol çiziliyor...");
    calculateBtn.disabled = true;
    generateBtn.disabled = true;
    removeSingleRouteLayer(); // Önceki rotayı temizle

    // API'ye göndermek için tüm koordinatları hazırla (lon,lat;lon,lat;...)
    const allCoordsString = orderedRoute.map(loc => loc.coords.join(',')).join(';');

    // Mapbox Directions API'ye TEK BİR istek gönder
    const apiUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${allCoordsString}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Mapbox Directions API Hatası: ${response.status} - ${errorData.message || errorData.code || 'Bilinmeyen hata'}`);
        }
        const data = await response.json();

        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const routeGeometry = route.geometry; // Tüm rotanın geometrisi
            const totalDuration = route.duration; // Saniye
            const totalDistance = route.distance; // Metre

            const durationMinutes = (totalDuration / 60).toFixed(1);
            const distanceKm = (totalDistance / 1000).toFixed(1);

            routeInfoDiv.innerHTML = `En Yakın Komşu Rota (Tek Seferde Çizildi): Yaklaşık <strong>${durationMinutes} dakika</strong>, <strong>${distanceKm} km</strong>`;

            // Tüm rotayı tek bir katmanda çiz
            drawSingleRoute(routeGeometry);

            // Sıralı listeyi göster (Bu fonksiyon değişmedi)
            displayOrderedRouteList(orderedRoute);

            console.log("Mapbox Directions (Tüm Rota) sonucu:", data);
        } else {
            console.error("Mapbox Directions sonucu alınamadı:", data);
            routeInfoDiv.innerHTML = "Hata: Rota geometrisi bulunamadı.";
            locationsListContainer.innerHTML = '<h4>Rota Çizim Hatası</h4><p>Adres sırası gösterilemiyor.</p>';
        }

    } catch (error) {
        console.error("Rota çizim hatası:", error);
        routeInfoDiv.innerHTML = `Hata: Rota çizilemedi. (${error.message})`;
        locationsListContainer.innerHTML = '<h4>Rota Çizim Hatası</h4><p>Adres sırası gösterilemiyor.</p>';
    } finally {
        setLoading(false);
        calculateBtn.disabled = false;
        generateBtn.disabled = false;
    }
}

// --- 11. Tek Bir Rota Katmanını Çizen Fonksiyon (YENİ / GÜNCELLENDİ) ---
// Renk geçişi kaldırıldı, sabit renk kullanılıyor.
function drawSingleRoute(geometry) {
    removeSingleRouteLayer(); // Varsa eski rotayı kaldır

    map.addSource(routeLayerId, {
        'type': 'geojson',
        'data': geometry
    });
    map.addLayer({
        'id': routeLayerId,
        'type': 'line',
        'source': routeLayerId,
        'layout': {
            'line-join': 'round',
            'line-cap': 'round'
        },
        'paint': {
            'line-color': '#483D8B', // Sabit bir renk (örn: Koyu Parlement Mavisi)
            'line-width': 5,
            'line-opacity': 0.8
        }
    }, map.getStyle().layers.find(layer => layer.type === 'symbol' && layer.layout['text-field'])?.id);
}

// Tek rota katmanını temizleyen fonksiyon (YENİ / GÜNCELLENDİ)
function removeSingleRouteLayer() {
    if (map.getLayer(routeLayerId)) {
        map.removeLayer(routeLayerId);
    }
    if (map.getSource(routeLayerId)) {
        map.removeSource(routeLayerId);
    }
    // routeLayerIds dizisine gerek kalmadı
}


// --- 12. Sıralı Listeyi Gösterme (Değişiklik Yok) ---
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

        if (index === 0) { label = "Başlangıç: "; }
        else if (index === orderedRoute.length - 1) { label = `Bitiş (${index}): `; }
        else { label = `${index}. Durak${originalIndexInfo}: `; }

        listItem.textContent = `${label}${location.address}`;
        orderedListElement.appendChild(listItem);
    });
    locationsListContainer.appendChild(orderedListElement);
}

// --- 13. Yükleme Göstergesi (Değişiklik Yok) ---
function setLoading(isLoading, message = "İşlem yapılıyor...") {
    loadingIndicator.textContent = message;
    loadingIndicator.style.display = isLoading ? 'block' : 'none';
}

// --- 14. OLAY DİNLEYİCİLERİ VE BAŞLATMA (calculate Butonu Güncellendi) ---
generateBtn.addEventListener('click', () => {
    const randomPoints = generateRandomPointsInBounds(NUM_RANDOM_LOCATIONS, SIIRT_MERKEZ_BOUNDS);
    displayLocationsAndGetAddresses(SIIRT_PTT_LOCATION, randomPoints);
});

// Hesaplama butonu artık NN sırasını bulup, TÜM rotayı tek seferde çizdiriyor
calculateBtn.addEventListener('click', () => {
    if (locationData.length > 0) {
        const orderedRoute = nearestNeighborTSP(SIIRT_PTT_LOCATION, locationData);
        calculateAndDrawNNRoute(orderedRoute); // Yeni fonksiyonu çağır
    } else {
        alert("Önce gösterilecek noktalar üretilmelidir.");
    }
});

// Sayfa yüklendiğinde haritayı başlat
initializeMap();