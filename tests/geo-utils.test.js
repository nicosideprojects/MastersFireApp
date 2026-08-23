// Run with: node --test tests/geo-utils.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    haversine, findNearest, findNearestN, destinationPoint,
    bearingToCompass, waterType, isCovered, computeCoverage, greedyMCLP
} = require('../app/geo-utils.js');

const LONDON_LAT = 51.5074, LONDON_LON = -0.1278;
const PARIS_LAT = 48.8566, PARIS_LON = 2.3522;
// 120m is the default hydrant coverage radius
const HYDRANT_RADIUS_KM = 0.12;

test('haversine: same point is zero distance', () => {
    assert.equal(haversine(LONDON_LAT, LONDON_LON, LONDON_LAT, LONDON_LON), 0);
});

test('haversine: London to Paris is about 344km', () => {
    const d = haversine(LONDON_LAT, LONDON_LON, PARIS_LAT, PARIS_LON);
    assert.ok(Math.abs(d - 344) < 5, `expected ~344km, got ${d}`);
});

// starting from the equator, 1 degree east is about 111.32km away
test('destinationPoint: 1 degree east at the equator is about 111km away', () => {
    const [lat, lon] = destinationPoint(0, 0, 90, 111.32);
    assert.ok(Math.abs(lat - 0) < 0.01, `expected lat ~0, got ${lat}`);
    assert.ok(Math.abs(lon - 1) < 0.01, `expected lon ~1, got ${lon}`);
});

test('bearingToCompass: cardinal and intercardinal directions', () => {
    assert.equal(bearingToCompass(0), 'N');
    assert.equal(bearingToCompass(45), 'NE');
    assert.equal(bearingToCompass(90), 'E');
    assert.equal(bearingToCompass(180), 'S');
    assert.equal(bearingToCompass(270), 'W');
    assert.equal(bearingToCompass(360), 'N');
});

test('waterType: reads OSM tags in priority order', () => {
    assert.equal(waterType({ leisure: 'swimming_pool' }), 'Swimming Pool');
    assert.equal(waterType({ landuse: 'reservoir' }), 'Reservoir');
    assert.equal(waterType({ water: 'lake' }), 'Lake');
    assert.equal(waterType({ water: 'canal' }), 'Canal');
    assert.equal(waterType({}), 'Water Body');
});

function featureAt(lon, lat) {
    return { geometry: { coordinates: [lon, lat] } };
}

// three random points around London, the middle one exactly matches the query point (dist 0)
test('findNearest: picks the closest feature', () => {
    const features = [featureAt(-0.2, 51.5), featureAt(-0.1, 51.5), featureAt(0.5, 51.9)];
    const nearest = findNearest(51.5, -0.1, features);
    assert.equal(nearest.feature, features[1]);
    assert.equal(nearest.dist, 0);
});

test('findNearestN: sorts ascending and slices to n', () => {
    const features = [featureAt(-0.5, 51.5), featureAt(-0.1, 51.5), featureAt(-0.3, 51.5)];
    const result = findNearestN(51.5, -0.1, features, 2);
    assert.equal(result.length, 2);
    assert.equal(result[0].feature, features[1]);
    assert.ok(result[0].dist <= result[1].dist);
});

// the second point is 10+km away, well outside the radius
test('isCovered: true within radius, false outside it', () => {
    const points = [featureAt(LONDON_LON, LONDON_LAT)];
    assert.equal(isCovered(LONDON_LAT, LONDON_LON, HYDRANT_RADIUS_KM, points), true);
    assert.equal(isCovered(51.6, -0.5, HYDRANT_RADIUS_KM, points), false);
});

// a fake version of the turf map library to give enough for computeCoverage to run tests
const fakeTurf = {
    centroid: hex => ({ geometry: { coordinates: hex.centroid } }),
    booleanPointInPolygon: (point, polygon) => polygon.contains(point.geometry.coordinates)
};

// one hydrant at central London - same point as the isCovered test above
const oneHydrant = [featureAt(LONDON_LON, LONDON_LAT)];

test('computeCoverage: sorts cells into covered vs uncovered', () => {
    const hexGrid = {
        features: [
            { id: 'covered', centroid: [LONDON_LON, LONDON_LAT] },
            { id: 'uncovered', centroid: [-0.5, 51.6] }
        ]
    };
    const result = computeCoverage(oneHydrant, [], HYDRANT_RADIUS_KM, hexGrid, fakeTurf);

    assert.equal(result.coveredHexes.length, 1);
    assert.equal(result.coveredHexes[0].hex.id, 'covered');
    assert.equal(result.uncoveredHexes.length, 1);
    assert.equal(result.uncoveredHexes[0].hex.id, 'uncovered');
    assert.equal(result.totalCells, 2);
});

test('computeCoverage: demand mask excludes a cell from both covered and uncovered', () => {
    const MASKED_LAT = 51.55, MASKED_LON = -0.2;
    const hexGrid = {
        features: [
            { id: 'covered', centroid: [LONDON_LON, LONDON_LAT] },
            { id: 'uncovered', centroid: [-0.5, 51.6] },
            { id: 'masked', centroid: [MASKED_LON, MASKED_LAT] }
        ]
    };
    // matches only the masked cells centroid
    const demandMask = [{ contains: ([lon, lat]) => lon === MASKED_LON && lat === MASKED_LAT }];
    const result = computeCoverage(oneHydrant, demandMask, HYDRANT_RADIUS_KM, hexGrid, fakeTurf);

    assert.equal(result.totalCells, 2);
    assert.ok(!result.coveredHexes.some(({ hex }) => hex.id === 'masked'));
    assert.ok(!result.uncoveredHexes.some(({ hex }) => hex.id === 'masked'));
});

test('computeCoverage: an empty demand mask never excludes any cell', () => {
    const hexGrid = { features: [{ id: 'a', centroid: [LONDON_LON, LONDON_LAT] }] };
    const result = computeCoverage(oneHydrant, [], HYDRANT_RADIUS_KM, hexGrid, fakeTurf);
    assert.equal(result.totalCells, 1);
});

test('greedyMCLP: picks the point that covers the most demand first', () => {
    // cluster points are 55-110m apart (within the 150m test radius); the lone point is 10+km away, outside it
    const cluster = [[51.50, -0.10], [51.5005, -0.10], [51.501, -0.10]];
    const lone = [51.60, -0.30];
    const candidates = greedyMCLP([...cluster, lone], 0.15, 2);

    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].covering, 3);
    assert.equal(candidates[1].covering, 1);
});
