// --- 1. MAPBOX TOKEN'INIZI BURAYA GİRİN ---
// !!! GÜVENLİK UYARISI: Önceki yanıttaki uyarıyı dikkate alın ve YENİ token kullanın !!!
mapboxgl.accessToken = 'pk.eyJ1IjoiZG94YTU2IiwiYSI6ImNtYTZraDQzNjAyMG0yanF6NmgwbXN0MDUifQ.V70oJ3N2-PALS12i959MaQ';

// --- 2. SABİTLER VE BAŞLANGIÇ NOKTASI ---
const SIIRT_PTT_LOCATION = { coords: [41.9420, 37.9275], address: "Siirt PTT Müdürlüğü" };
const NUM_RANDOM_LOCATIONS = 11;

// Siirt Merkez Mahallelerini kabaca içeren sınırlayıcı kutu
const SIIRT_MERKEZ_BOUNDS = [41.915, 37.920, 41.955, 37.945];

// --- 3. GLOBAL DEĞİŞKENLER ---
let map;
let markers = [];
let routeLayerIds = [];
// locationData formatı güncellendi: { coords: [lon, lat], address: "...", originalIndex: number }
let locationData = [];
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

// --- 6. REVERSE GEOCODING (Mapbox ile Adres Bulma - Değişiklik Yok) ---
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

// --- 7. NOKTALARI GÖSTERME VE ADRESLERİ ALMA (GÜNCELLENDİ - originalIndex eklendi) ---
async function displayLocationsAndGetAddresses(startLocation, randomPoints) {
    setLoading(true, "Noktalar ve adresler yükleniyor...");
    locationData = []; // Önceki verileri temizle
    locationsListContainer.innerHTML = '<h4>Bulunan Adresler (Sırasız):</h4>';
    const unorderedList = document.createElement('ul');
    locationsListContainer.appendChild(unorderedList);
    routeInfoDiv.innerHTML = '';
    calculateBtn.disabled = true;

    markers.forEach(marker => marker.remove());
    markers = [];
    removeRouteLayers();

    // Başlangıç noktasını ekle
    const startMarker = new mapboxgl.Marker({ color: '#28a745' })
        .setLngLat(startLocation.coords)
        .setPopup(new mapboxgl.Popup().setText(startLocation.address))
        .addTo(map);
    markers.push(startMarker);

    // Rastgele noktalar için adresleri bul ve göster
    let pointCounter = 1; // Bu sayaç 1'den N'e kadar gidecek (N=NUM_RANDOM_LOCATIONS)
    for (const coords of randomPoints) {
        const address = await reverseGeocode(coords);
        // Koordinat, adres VE orijinal rastgele sıra numarasını sakla
        locationData.push({
            coords: coords,
            address: address,
            originalIndex: pointCounter // 1'den N'e kadar olan index
        });

        const marker = new mapboxgl.Marker({ color: '#007bff' })
            .setLngLat(coords)
            // Popup'ta da orijinal index'i gösterelim
            .setPopup(new mapboxgl.Popup({ offset: 25 }).setText(`Nokta ${pointCounter}: ${address}`))
            .addTo(map);
        markers.push(marker);

        // Listeye adresi ve orijinal index'i ekle (sırasız olarak)
        const listItem = document.createElement('li');
        listItem.textContent = `Nokta ${pointCounter}: ${address}`;
        unorderedList.appendChild(listItem);
        pointCounter++; // Sonraki nokta için sayacı artır
    }

    if (locationData.length > 0) {
        calculateBtn.disabled = false;
    }
    setLoading(false);
}


// --- 8. KUŞ UÇUŞU MESAFE HESAPLAMA (Değişiklik Yok) ---
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

// --- 9. EN YAKIN KOMŞU ALGORİTMASI (Değişiklik Yok) ---
function nearestNeighborTSP(startLocation, points) {
    let currentLocation = startLocation;
    // Önemli: Rota nesneleri sadece {coords, address} değil, originalIndex'i de içermeli
    // Ancak sıralama sadece coords'a göre yapıldığı için algoritma değişmez.
    // Sadece dönen listedeki nesneler daha fazla bilgi içerir.
    let orderedRoute = [startLocation]; // PTT nesnesi {coords, address} içeriyor sadece
    let remainingPoints = points.map(p => ({ ...p, visited: false })); // Ziyaret durumunu ekle

    // Ziyaret edilecek nokta sayısı kadar dön
    const numPointsToVisit = remainingPoints.length;
    for(let visitCount = 0; visitCount < numPointsToVisit; visitCount++){
        let nearestPoint = null;
        let nearestDistance = Infinity;
        let nearestInternalIndex = -1; // remainingPoints içindeki index

        for (let i = 0; i < remainingPoints.length; i++) {
            if (!remainingPoints[i].visited) { // Sadece ziyaret edilmemişlere bak
                const distance = haversineDistance(currentLocation.coords, remainingPoints[i].coords);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestPoint = remainingPoints[i];
                    nearestInternalIndex = i;
                }
            }
        }

        if (nearestPoint) {
            nearestPoint.visited = true; // Ziyaret edildi olarak işaretle
            orderedRoute.push(nearestPoint); // Rotaya ekle
            currentLocation = nearestPoint; // Mevcut konumu güncelle
            // Kalanlardan çıkarma yerine işaretlemek daha verimli olabilir,
            // ama splice ile devam edelim şimdilik. Alternatif: visited kontrolü.
            // splice kullanıyorsak visited flag'ine gerek yok aslında.
        } else {
             if(remainingPoints.filter(p => !p.visited).length === 0) break; // Ziyaret edilmeyen kalmadıysa çık
             console.error("Hata: Ziyaret edilmemiş en yakın nokta bulunamadı!");
             break; // Hata durumu
        }
    }
     // Kalanları temizleyelim (splice yerine visited kullanıldıysa)
    // orderedRoute = orderedRoute.filter(p => p !== undefined); // Varsa undefined temizle

    orderedRoute.push(startLocation); // Başa dön
    return orderedRoute;
}


// --- 10. YOL AĞI ÜZERİNDEN ROTA ÇİZME VE BİLGİ HESAPLAMA (Değişiklik Yok - Renk Geçişi Dahil) ---
async function drawRouteAndCalculateInfo(orderedRoute) {
    setLoading(true, "Yol ağı üzerinden rota çiziliyor...");
    calculateBtn.disabled = true;
    generateBtn.disabled = true;
    removeRouteLayers();

    let totalDuration = 0;
    let totalDistance = 0;
    const segmentPromises = [];
    const totalSegments = orderedRoute.length - 1;

    for (let i = 0; i < totalSegments; i++) {
        const start = orderedRoute[i].coords;
        const end = orderedRoute[i + 1].coords;
        const coordsString = `${start[0]},${start[1]};${end[0]},${end[1]}`;
        const apiUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordsString}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`;

        const progress = totalSegments <= 1 ? 0.5 : i / (totalSegments - 1);
        const segmentColor = interpolateColor(0, 255, 0, 255, 0, 0, progress);

        segmentPromises.push(
            fetch(apiUrl)
                .then(response => response.ok ? response.json() : Promise.reject(`API Error ${response.status}`))
                .then(data => {
                    if (data.routes && data.routes.length > 0) {
                        const route = data.routes[0];
                        return { geometry: route.geometry, duration: route.duration, distance: route.distance, color: segmentColor, id: `route-segment-${i}` };
                    }
                    console.warn(`Segment ${i + 1} için rota bulunamadı.`);
                    return { geometry: { type: 'LineString', coordinates: [start, end] }, duration: 0, distance: 0, color: segmentColor, id: `route-segment-${i}` };
                })
                .catch(error => {
                     console.error(`Rota segmenti ${i + 1} alınamadı:`, error);
                     return { geometry: { type: 'LineString', coordinates: [start, end] }, duration: 0, distance: 0, color: segmentColor, id: `route-segment-${i}` };
                })
        );
    }

    const segmentResults = await Promise.all(segmentPromises);
    segmentResults.forEach(result => {
        if (result) {
            totalDuration += result.duration;
            totalDistance += result.distance;
            drawRouteSegment(result.geometry, result.id, result.color);
        }
    });

    const durationMinutes = (totalDuration / 60).toFixed(1);
    const distanceKm = (totalDistance / 1000).toFixed(1);
    routeInfoDiv.innerHTML = `En Yakın Komşu Rota: Yaklaşık <strong>${durationMinutes} dakika</strong>, <strong>${distanceKm} km</strong> (Yol Ağı Üzerinden)`;

    displayOrderedRouteList(orderedRoute); // Sıralı listeyi göster

    setLoading(false);
    calculateBtn.disabled = false;
    generateBtn.disabled = false;
}

// Renk Geçişi Fonksiyonu (Değişiklik Yok)
function interpolateColor(r1, g1, b1, r2, g2, b2, progress) {
    const r = Math.round(r1 + (r2 - r1) * progress);
    const g = Math.round(g1 + (g2 - g1) * progress);
    const b = Math.round(b1 + (b2 - b1) * progress);
    const toHex = (c) => c.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Tek Bir Rota Segmentini Çizen Fonksiyon (Değişiklik Yok)
function drawRouteSegment(geometry, layerId, lineColor) {
    routeLayerIds.push(layerId);
    if (map.getSource(layerId)) {
        map.getSource(layerId).setData(geometry);
        if(map.getLayer(layerId)) map.setPaintProperty(layerId, 'line-color', lineColor);
    } else {
        map.addSource(layerId, { 'type': 'geojson', 'data': geometry });
        map.addLayer({
            'id': layerId, 'type': 'line', 'source': layerId,
            'layout': { 'line-join': 'round', 'line-cap': 'round' },
            'paint': { 'line-color': lineColor, 'line-width': 5, 'line-opacity': 0.85 }
        }, map.getStyle().layers.find(layer => layer.type === 'symbol' && layer.layout['text-field'])?.id);
    }
}

// Tüm rota katmanlarını temizleyen fonksiyon (Değişiklik Yok)
function removeRouteLayers() {
    routeLayerIds.forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
    });
    routeLayerIds = [];
}

// --- 11. Sıralı Listeyi Gösterme (GÜNCELLENDİ - Orijinal Index Eklendi) ---
function displayOrderedRouteList(orderedRoute) {
    locationsListContainer.innerHTML = '<h4>En Yakın Komşu Rota Sırası:</h4>';
    const orderedListElement = document.createElement('ol');

    orderedRoute.forEach((location, index) => {
        const listItem = document.createElement('li');
        let label = "";
        let originalIndexInfo = ""; // Orijinal random nokta sırasını tutacak

        // location nesnesi { coords:..., address:..., originalIndex:... } veya sadece {coords:..., address:...} (PTT için)
        if (location.originalIndex !== undefined) {
            originalIndexInfo = ` (Nokta ${location.originalIndex})`;
        }

        if (index === 0) {
            label = "Başlangıç: ";
        } else if (index === orderedRoute.length - 1) {
            label = `Bitiş (${index}): `; // Son adımın sırasını da gösterelim
        } else {
            // Aradaki duraklar için (index 1'den N'e kadar)
            label = `${index}. Durak${originalIndexInfo}: `; // Parantez içinde orijinal index
        }
        listItem.textContent = `${label}${location.address}`;
        orderedListElement.appendChild(listItem);
    });

    locationsListContainer.appendChild(orderedListElement);
}


// --- 12. Yükleme Göstergesi (Değişiklik Yok) ---
function setLoading(isLoading, message = "İşlem yapılıyor...") {
    loadingIndicator.textContent = message;
    loadingIndicator.style.display = isLoading ? 'block' : 'none';
}

// --- 13. OLAY DİNLEYİCİLERİ VE BAŞLATMA (Değişiklik Yok) ---
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

// Sayfa yüklendiğinde haritayı başlat
initializeMap();