// Shared geo/math helpers used by both operations.html and planning.html.
// Plain functions, no DOM/Leaflet dependency, so they can be unit tested with Node.

// calculates distance between two points in km using the haversine formula
function haversine(lat1, lon1, lat2, lon2) {
    const earthRadiusKm = 6371;
    // lat/lon differences, converted to radians
    const deltaLat = (lat2 - lat1) * Math.PI / 180;
    const deltaLon = (lon2 - lon1) * Math.PI / 180;
    // core haversine formula term
    const haversineTerm = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(deltaLon / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversineTerm), Math.sqrt(1 - haversineTerm));
}

// finds the closest feature to a point, out of a list of GeoJSON features
function findNearest(lat, lon, features) {
    let nearest = null, minDist = Infinity;
    features.forEach(feature => {
        const [featureLon, featureLat] = feature.geometry.coordinates;
        const dist = haversine(lat, lon, featureLat, featureLon);
        if (dist < minDist) { minDist = dist; nearest = { feature, dist }; }
    });
    return nearest;
}

// same as findNearest, but returns the n closest features sorted by distance
function findNearestN(lat, lon, features, n) {
    return features
        .map(feature => {
            const [featureLon, featureLat] = feature.geometry.coordinates;
            return { feature, dist: haversine(lat, lon, featureLat, featureLon) };
        })
        .sort((a, b) => a.dist - b.dist)
        .slice(0, n);
}

// finds the lat/lon reached by travelling distKm from a point along a compass bearing
function destinationPoint(lat, lon, bearing, distKm) {
    const earthRadiusKm = 6371;
    // angular distance travelled, in radians
    const angularDist = distKm / earthRadiusKm;
    const bearingRad = bearing * Math.PI / 180;
    const lat1 = lat * Math.PI / 180, lon1 = lon * Math.PI / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDist) + Math.cos(lat1) * Math.sin(angularDist) * Math.cos(bearingRad));
    const lon2 = lon1 + Math.atan2(Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(lat1), Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2));
    return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
}

// converts a compass bearing in degrees to an 8-point compass direction
function bearingToCompass(bearing) {
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8];
}

// labels a water feature's type from its OSM tags, in priority order
function waterType(props) {
    if (props.leisure === 'swimming_pool') return 'Swimming Pool';
    if (props.landuse === 'reservoir') return 'Reservoir';
    const waterTag = props.water;
    if (waterTag === 'reservoir') return 'Reservoir';
    if (waterTag === 'lake') return 'Lake';
    if (waterTag === 'pond') return 'Pond';
    if (waterTag === 'river') return 'River';
    if (waterTag === 'canal') return 'Canal';
    return 'Water Body';
}

// adds new features to a list without duplicating ones already close by
function mergeUniqueFeatures(existingFeatures, incomingFeatures, dedupDistanceKm) {
    const merged = existingFeatures.slice();
    incomingFeatures.forEach(incoming => {
        const [incomingLon, incomingLat] = incoming.geometry.coordinates;
        const isDuplicate = merged.some(existing => {
            const [existingLon, existingLat] = existing.geometry.coordinates;
            return haversine(incomingLat, incomingLon, existingLat, existingLon) <= dedupDistanceKm;
        });
        if (!isDuplicate) merged.push(incoming);
    });
    return merged;
}

// sorts a live OSM elements tags into which map layer it belongs to
function classifyLiveFeature(tags) {
    if (!tags) return null;
    if (tags.emergency === 'fire_hydrant') return 'hydrant';
    if (tags.natural === 'water' || tags.landuse === 'reservoir' || tags.leisure === 'swimming_pool') return 'water';
    if (tags.amenity === 'hospital' || tags.amenity === 'clinic') return 'hospital';
    return null;
}

// standard geodetic approximation: how many km one degree of latitude covers
// TODO: remember to add the reference for this
const KM_PER_DEGREE_LATITUDE = 111.0;
// extra padding on the bounding box so it doesnt cut off a point the haversine check would include
const BBOX_SAFETY_MARGIN = 1.1;

// Bounding-box pre-filter then haversine for fast coverage checks.
// `points` is a list of GeoJSON features with [lon, lat] coordinates.
function isCovered(lat, lon, radiusKm, points) {
    // radius in degrees, padded by the safety margin
    const latDelta = radiusKm / KM_PER_DEGREE_LATITUDE * BBOX_SAFETY_MARGIN;
    // same idea, but degrees of longitude shrink the further from the equator you are
    const lonDelta = radiusKm / (KM_PER_DEGREE_LATITUDE * Math.cos(lat * Math.PI / 180)) * BBOX_SAFETY_MARGIN;
    // true if any point passes both the cheap box check and the distance check
    return points.some(point => {
        const [pointLon, pointLat] = point.geometry.coordinates;
        if (Math.abs(pointLat - lat) > latDelta) return false;
        if (Math.abs(pointLon - lon) > lonDelta) return false;
        return haversine(lat, lon, pointLat, pointLon) <= radiusKm;
    });
}

// Sorts each grid cell into covered or uncovered, ignoring any cell inside a masked-out area
function computeCoverage(hydrants, demandMask, radiusKm, hexGrid, turfLib) {
    const coveredHexes = [];
    const uncoveredHexes = [];

    hexGrid.features.forEach(hex => {
        const centroid = turfLib.centroid(hex);
        const [lon, lat] = centroid.geometry.coordinates;

        if (demandMask.some(polygon => {
            try { return turfLib.booleanPointInPolygon(centroid, polygon); } catch { return false; }
        })) return;

        if (isCovered(lat, lon, radiusKm, hydrants)) {
            coveredHexes.push({ hex, lat, lon });
        } else {
            uncoveredHexes.push({ hex, lat, lon });
        }
    });

    return { coveredHexes, uncoveredHexes, totalCells: coveredHexes.length + uncoveredHexes.length };
}

// simple greedy MCLP: repeatedly pick the point that covers the most
// remaining demand, then remove what it covers, until we have enough sites
function greedyMCLP(uncoveredCentroids, radiusKm, numCandidates = 5) {
    const remaining = uncoveredCentroids.map(([lat, lon]) => ({ lat, lon }));
    const candidates = [];

    for (let i = 0; i < numCandidates && remaining.length > 0; i++) {
        // find the point that covers the most remaining demand
        let bestIdx = 0, bestCount = 0;
        remaining.forEach((point, idx) => {
            const count = remaining.filter(demandPoint =>
                haversine(point.lat, point.lon, demandPoint.lat, demandPoint.lon) <= radiusKm
            ).length;
            if (count > bestCount) { bestCount = count; bestIdx = idx; }
        });

        const best = remaining[bestIdx];
        candidates.push({ lat: best.lat, lon: best.lon, covering: bestCount });

        // remove demand points this candidate now covers
        const stillUncovered = remaining.filter(demandPoint =>
            haversine(best.lat, best.lon, demandPoint.lat, demandPoint.lon) > radiusKm
        );
        remaining.splice(0, remaining.length, ...stillUncovered);
    }
    return candidates;
}

// keeps a coverage radius within a safe range
function clampRadiusM(radiusM, minM = 1, maxM = 1000, fallbackM = 120) {
    const value = Number.isFinite(radiusM) ? radiusM : fallbackM;
    return Math.min(maxM, Math.max(minM, value));
}

// Beaufort wind force scale bands with upper km/h bound per term
const BEAUFORT_SCALE = [
    { upToKmh: 1, term: 'calm' },
    { upToKmh: 5, term: 'light air' },
    { upToKmh: 11, term: 'light breeze' },
    { upToKmh: 19, term: 'gentle breeze' },
    { upToKmh: 28, term: 'moderate breeze' },
    { upToKmh: 38, term: 'fresh breeze' },
    { upToKmh: 49, term: 'strong breeze' },
    { upToKmh: 61, term: 'near gale' },
    { upToKmh: 74, term: 'gale' },
    { upToKmh: 88, term: 'strong gale' },
    { upToKmh: 102, term: 'storm' },
    { upToKmh: 117, term: 'violent storm' },
];
const HURRICANE_FORCE_TERM = 'hurricane force';

// labels a wind speed (km/h) with its Beaufort scale term
function windDescription(speedKmh) {
    const band = BEAUFORT_SCALE.find(({ upToKmh }) => speedKmh <= upToKmh);
    return band ? band.term : HURRICANE_FORCE_TERM;
}

// Node's CommonJS require() sees this and grabs the exports; browsers loading
// this as a plain <script> never define `module`, so they just get the globals above.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { haversine, findNearest, findNearestN, destinationPoint, bearingToCompass, waterType, mergeUniqueFeatures, classifyLiveFeature, isCovered, computeCoverage, greedyMCLP, clampRadiusM, windDescription };
}
