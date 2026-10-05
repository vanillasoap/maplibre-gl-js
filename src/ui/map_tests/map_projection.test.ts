import {afterEach, beforeEach, describe, test, expect, onTestFinished, vi} from 'vitest';
import {createMap, beforeMapTest, createRotatedCrs} from '../../util/test/util.ts';
import {addProjection, removeProjection} from '../../geo/projection/projection_crud.ts';
import {OverscaledTileID} from '../../tile/tile_id.ts';
import {MAX_VALID_LATITUDE} from '../../util/util.ts';

import type {GeoJSONSource} from '../../source/geojson_source.ts';

beforeEach(() => {
    beforeMapTest();
    global.fetch = null;
});

describe('Map in the simple projection', () => {
    test('loads a style that declares the simple projection', async () => {
        const map = createMap({style: {version: 8, sources: {}, layers: [], projection: {type: 'simple'}}});
        await map.once('style.load');

        expect(map.getProjection()).toEqual({type: 'simple'});
    });

    test('keeps an initial center north of the mercator latitude limit', async () => {
        const latitudeNorthOfMercatorLimit = MAX_VALID_LATITUDE + 1;
        const map = createMap({style: {version: 8, sources: {}, layers: [], projection: {type: 'simple'}}, center: [0, latitudeNorthOfMercatorLimit], zoom: 6});
        await map.once('style.load');

        expect(map.getCenter().lat).toBeCloseTo(latitudeNorthOfMercatorLimit, 6);
    });

    test('returns to the simple projection after a round trip through globe', async () => {
        const map = createMap();
        await map.once('style.load');

        map.setProjection({type: 'simple'});
        map.setProjection({type: 'globe'});
        expect(map.getProjection()).toEqual({type: 'globe'});

        map.setProjection({type: 'simple'});
        expect(map.getProjection()).toEqual({type: 'simple'});
    });

    test('stops the center where the viewport reaches the east edge of the world square', async () => {
        const map = createMap({style: {version: 8, sources: {}, layers: [], projection: {type: 'simple'}}, zoom: 3});
        await map.once('style.load');
        const worldSizeAtZoom3 = 4096;
        const degreesPerPixel = 180 / worldSizeAtZoom3;
        const halfContainer = map.getContainer().clientWidth / 2;

        map.setCenter([170, 0]);

        expect(map.getCenter().lng).toBeCloseTo(90 - halfContainer * degreesPerPixel, 6);
    });
});

describe('Map in a CRS registered with addProjection', () => {
    afterEach(() => {
        removeProjection(createRotatedCrs().name);
    });

    test('setProjection accepts the registered name', async () => {
        const crs = createRotatedCrs();
        addProjection(crs);
        const map = createMap();
        await map.once('style.load');

        map.setProjection({type: crs.name});

        expect(map.getProjection()).toEqual({type: crs.name});
    });

    test('projects lng/lat to the screen through the registered CRS', async () => {
        const crs = createRotatedCrs();
        addProjection(crs);
        const map = createMap();
        await map.once('style.load');
        map.setProjection({type: crs.name});
        const worldSizeAtZoom0 = 512;
        const worldOffsetInContainer = (worldSizeAtZoom0 - map.getContainer().clientWidth) / 2;
        const worldFractionOfCrsPoint = {x: 0.7, y: 0.5};
        const {origin, extentAtZoom0} = crs.tileMatrix;
        const crsPoint = {x: origin[0] + worldFractionOfCrsPoint.x * extentAtZoom0, y: origin[1] - worldFractionOfCrsPoint.y * extentAtZoom0};

        const screenPoint = map.project(crs.unproject(crsPoint.x, crsPoint.y));

        expect(screenPoint.x).toBeCloseTo(worldFractionOfCrsPoint.x * worldSizeAtZoom0 - worldOffsetInContainer, 6);
        expect(screenPoint.y).toBeCloseTo(worldFractionOfCrsPoint.y * worldSizeAtZoom0 - worldOffsetInContainer, 6);
    });
});

describe('sources after changing projection', () => {
    test.each(['vector', 'raster', 'raster-dem'] as const)('%s bounds follow the selected projection', async (type) => {
        const map = createMap({style: {
            version: 8,
            sources: {bounded: {type, tiles: ['http://localhost/{z}/{x}/{y}'], bounds: [40, 40, 50, 50]}},
            layers: [],
        }});
        onTestFinished(() => map.remove());
        await map.once('style.load');
        await vi.waitFor(() => expect(map.isSourceLoaded('bounded')).toBe(true));
        const source = map.getSource('bounded');
        const tile = new OverscaledTileID(4, 0, 4, 12, 4);
        expect(source.hasTile(tile)).toBe(false);

        map.setProjection({type: 'simple'});
        expect(source.hasTile(tile)).toBe(true);

        map.setProjection({type: 'mercator'});
        expect(source.hasTile(tile)).toBe(false);
    });

    test.each(['properties', 'geometry'] as const)('reprojects hidden GeoJSON after a %s update', async (change) => {
        const map = createMap({center: [45, 45], zoom: 3, style: {
            version: 8,
            sources: {points: {type: 'geojson', data: {type: 'FeatureCollection', features: [
                {type: 'Feature', id: 1, properties: {}, geometry: {type: 'Point', coordinates: [45, 45]}},
                {type: 'Feature', id: 2, properties: {}, geometry: {type: 'Point', coordinates: [46, 45]}},
            ]}}},
            layers: [],
        }});
        onTestFinished(() => map.remove());
        await map.once('style.load');
        await vi.waitFor(() => expect(map.isSourceLoaded('points')).toBe(true));
        const source = map.getSource<GeoJSONSource>('points');

        map.setProjection({type: 'simple'});
        await source.updateData({update: [{id: 1,
            ...(change === 'geometry' ? {newGeometry: {type: 'Point' as const, coordinates: [45.5, 45]}} : {}),
            addOrUpdateProperties: [{key: 'name', value: 'updated'}],
        }]});
        map.addLayer({id: 'points', type: 'circle', source: 'points'});
        await map.once('idle');
        const features = map.querySourceFeatures('points');
        const updated = features.find(feature => feature.id === 1);
        const unchanged = features.find(feature => feature.id === 2);
        expect(updated).toBeDefined();
        expect(unchanged).toBeDefined();
        expect(updated.properties.name).toBe('updated');
        expect((updated.geometry as GeoJSON.Point).coordinates[0]).toBeCloseTo(change === 'geometry' ? 45.5 : 45, 2);
        expect((updated.geometry as GeoJSON.Point).coordinates[1]).toBeCloseTo(45, 2);
        expect((unchanged.geometry as GeoJSON.Point).coordinates[0]).toBeCloseTo(46, 2);
        expect((unchanged.geometry as GeoJSON.Point).coordinates[1]).toBeCloseTo(45, 2);
    });
});

test('keeps GeoJSON positioned after a second projection change during a worker reload', async () => {
    const map = createMap({center: [45, 45], zoom: 3, style: {
        version: 8,
        sources: {points: {type: 'geojson', data: {type: 'Point', coordinates: [45, 45]}}},
        layers: [{id: 'points', type: 'circle', source: 'points'}],
    }});
    onTestFinished(() => map.remove());
    await map.once('idle');
    map.once('sourcedataloading', () => {
        queueMicrotask(() => map.setProjection({type: 'mercator'}));
    });

    map.setProjection({type: 'simple'});
    await map.once('idle');

    const [feature] = map.querySourceFeatures('points');
    expect(feature).toBeDefined();
    expect((feature.geometry as GeoJSON.Point).coordinates[0]).toBeCloseTo(45, 2);
    expect((feature.geometry as GeoJSON.Point).coordinates[1]).toBeCloseTo(45, 2);
});
