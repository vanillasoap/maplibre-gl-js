import {mat4} from 'gl-matrix';
import {EXTENT} from '../../data/extent.ts';
import {clamp, degreesToRadians, MAX_VALID_LATITUDE, zoomScale, type Mat4f64} from '../../util/util.ts';
import {MercatorCoordinate} from '../mercator_coordinate.ts';
import Point from '@mapbox/point-geometry';

import type {WorldCoordinateHelper} from '../transform_interface.ts';
import type {UnwrappedTileIDType} from '../transform_helper.ts';
import type {LngLat} from '../lng_lat.ts';

/*
* The maximum angle to use for the Mercator horizon. This must be less than 90
* to prevent errors in `MercatorTransform::_calcMatrices()`. It shouldn't be too close
* to 90, or the distance to the horizon will become very large, unnecessarily increasing
* the number of tiles needed to render the map.
*/
export const maxMercatorHorizonAngle = 89.25;

/**
 * Returns mercator coordinates in range 0..1 for given coordinates inside a specified tile.
 * @param inTileX - X coordinate in tile units - range [0..EXTENT].
 * @param inTileY - Y coordinate in tile units - range [0..EXTENT].
 * @param canonicalTileID - Tile canonical ID - mercator X, Y and zoom.
 * @returns Mercator coordinates of the specified point in range [0..1].
 */
export function tileCoordinatesToMercatorCoordinates(inTileX: number, inTileY: number, canonicalTileID: {x: number; y: number; z: number}): MercatorCoordinate {
    const scale = 1.0 / (1 << canonicalTileID.z);
    return new MercatorCoordinate(
        inTileX / EXTENT * scale + canonicalTileID.x * scale,
        inTileY / EXTENT * scale + canonicalTileID.y * scale
    );
}

/**
 * Returns LngLat for given in-tile coordinates and tile ID.
 * @param inTileX - X coordinate in tile units - range [0..EXTENT].
 * @param inTileY - Y coordinate in tile units - range [0..EXTENT].
 * @param canonicalTileID - Tile canonical ID - mercator X, Y and zoom.
 */
export function tileCoordinatesToLocation(inTileX: number, inTileY: number, canonicalTileID: {x: number; y: number; z: number}): LngLat {
    return tileCoordinatesToMercatorCoordinates(inTileX, inTileY, canonicalTileID).toLngLat();
}

/**
 * Convert from LngLat to world coordinates (the projection's 0..1 world square scaled by world size).
 * @param worldSize - World size computed from zoom level and tile size.
 * @param lnglat - The location to convert.
 * @param helper - The lng/lat to world mapping; latitude is clamped to the valid mercator range only for a wrapping (mercator) helper.
 * @returns Point
 */
export function projectToWorldCoordinates(worldSize: number, lnglat: LngLat, helper: WorldCoordinateHelper): Point {
    const lat = helper.wraps ? clamp(lnglat.lat, -MAX_VALID_LATITUDE, MAX_VALID_LATITUDE) : lnglat.lat;
    const {x, y} = helper.worldFromLngLat(lnglat.lng, lat);
    return new Point(x * worldSize, y * worldSize);
}

/**
 * Convert from world coordinates (the projection's 0..1 world square scaled by world size) to LngLat.
 * @param worldSize - World size computed from zoom level and tile size.
 * @param point - World coordinate.
 * @param helper - The lng/lat to world mapping.
 * @returns LngLat
 */
export function unprojectFromWorldCoordinates(worldSize: number, point: Point, helper: WorldCoordinateHelper): LngLat {
    return helper.lngLatFromWorld(point.x / worldSize, point.y / worldSize);
}

/**
 * Calculate pixel height of the visible horizon in relation to map-center (e.g. height/2),
 * multiplied by a static factor to simulate the earth-radius.
 * The calculated value is the horizontal line from the camera-height to sea-level.
 * @returns Horizon above center in pixels.
 */
export function getMercatorHorizon(transform: {pitch: number; cameraToCenterDistance: number}): number {
    return transform.cameraToCenterDistance * Math.min(Math.tan(degreesToRadians(90 - transform.pitch)) * 0.85,
        Math.tan(degreesToRadians(maxMercatorHorizonAngle - transform.pitch)));
}

export function calculateTileMatrix(unwrappedTileID: UnwrappedTileIDType, worldSize: number): Mat4f64 {
    const canonical = unwrappedTileID.canonical;
    const scale = worldSize / zoomScale(canonical.z);
    const unwrappedX = canonical.x + Math.pow(2, canonical.z) * unwrappedTileID.wrap;

    const worldMatrix: Mat4f64 = new Float64Array(16);
    mat4.identity(worldMatrix);
    mat4.translate(worldMatrix, worldMatrix, [unwrappedX * scale, canonical.y * scale, 0]);
    mat4.scale(worldMatrix, worldMatrix, [scale / EXTENT, scale / EXTENT, 1]);
    return worldMatrix;
}

/**
 * Returns the camera position for a center already mapped to world coordinates.
 * Callers resolve the center through the transform's `WorldCoordinateHelper`; keeping the helper
 * out of this function lets the engine inline it on the per-frame camera path.
 * @param centerMercator - the center in world coordinates, with its elevation in `z`
 * @param dMercator - camera to center distance in world units
 */
export function cameraMercatorCoordinateFromCenterAndRotation(centerMercator: MercatorCoordinate, pitch: number, bearing: number, dMercator: number): MercatorCoordinate {
    const {x, y, z} = cameraDirectionFromPitchBearing(pitch, bearing);
    const dxMercator = dMercator * -x;
    const dyMercator = dMercator * -y;
    // Unlike x and y, z already points from the center up towards the camera.
    const dzMercator = dMercator * z;
    return new MercatorCoordinate(centerMercator.x + dxMercator, centerMercator.y + dyMercator, centerMercator.z + dzMercator);
}

/**
 * Returns the position of the camera in mercator coordinates, with its altitude in `z`.
 * Computed from the center, pitch, bearing and camera distance, so it holds for any projection.
 * @param center - The center to compute from, the transform's own by default.
 */
export function cameraMercatorCoordinate(transform: {
    center: LngLat;
    elevation: number;
    pitch: number;
    bearing: number;
    cameraToCenterDistance: number;
    worldSize: number;
    worldCoordinateHelper: WorldCoordinateHelper;
}, center: LngLat = transform.center): MercatorCoordinate {
    const worldCoordinateHelper = transform.worldCoordinateHelper;
    const mercUnitsPerMeter = worldCoordinateHelper.worldZFromAltitude(1, center);
    const pixelPerMeter = mercUnitsPerMeter * transform.worldSize;
    const distance = transform.cameraToCenterDistance / pixelPerMeter;
    const centerMercator = worldCoordinateHelper.worldFromLngLat(center.lng, center.lat, transform.elevation);
    return cameraMercatorCoordinateFromCenterAndRotation(centerMercator, transform.pitch, transform.bearing, distance * mercUnitsPerMeter);
}

export function cameraDirectionFromPitchBearing(pitch: number, bearing: number): {x: number; y: number; z: number} {
    const pitchRadians = degreesToRadians(pitch);
    const bearingRadians = degreesToRadians(bearing);
    const z = Math.cos(-pitchRadians);
    const h = Math.sin(pitchRadians);
    const x = h * Math.sin(bearingRadians);
    const y = -h * Math.cos(bearingRadians);
    return {x, y, z};
}

/** A rectangle in the output coordinates of a projection. */
type ProjectedBox = {minX: number; minY: number; maxX: number; maxY: number};

/**
 * Approximates the bounds of a smoothly projected rectangle by subdividing its edges. Each segment is split until its
 * midpoint deviates from the chord by at most `tolerance`, with at least eight segments per edge.
 * Twice the remaining midpoint error pads each segment for unresolved curvature between samples.
 * The depth limit bounds work near projection singularities.
 */
function projectBoxEdges(project: (x: number, y: number) => {x: number; y: number}, minX: number, minY: number, maxX: number, maxY: number, tolerance: number, curved: boolean): ProjectedBox {
    const corners: Array<[number, number]> = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
    const projected = corners.map(([x, y]) => project(x, y));
    const box = {
        minX: Math.min(...projected.map(p => p.x)),
        minY: Math.min(...projected.map(p => p.y)),
        maxX: Math.max(...projected.map(p => p.x)),
        maxY: Math.max(...projected.map(p => p.y)),
    };
    if (!curved) return box;

    function sampleEdge(ax: number, ay: number, bx: number, by: number, a: {x: number; y: number}, b: {x: number; y: number}, depth: number): void {
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const midpoint = project(mx, my);
        const errorX = Math.abs(midpoint.x - (a.x + b.x) / 2);
        const errorY = Math.abs(midpoint.y - (a.y + b.y) / 2);
        if (depth < 12 && (depth < 3 || Math.max(errorX, errorY) > tolerance)) {
            sampleEdge(ax, ay, mx, my, a, midpoint, depth + 1);
            sampleEdge(mx, my, bx, by, midpoint, b, depth + 1);
            return;
        }
        box.minX = Math.min(box.minX, a.x - 2 * errorX, midpoint.x - 2 * errorX, b.x - 2 * errorX);
        box.minY = Math.min(box.minY, a.y - 2 * errorY, midpoint.y - 2 * errorY, b.y - 2 * errorY);
        box.maxX = Math.max(box.maxX, a.x + 2 * errorX, midpoint.x + 2 * errorX, b.x + 2 * errorX);
        box.maxY = Math.max(box.maxY, a.y + 2 * errorY, midpoint.y + 2 * errorY, b.y + 2 * errorY);
    }

    for (let i = 0; i < 4; i++) {
        const next = (i + 1) % 4;
        sampleEdge(...corners[i], ...corners[next], projected[i], projected[next], 0);
    }
    return box;
}

/**
 * Projects a lng/lat box into world coordinates, sampling curved CRS edges to include their extrema.
 * Mercator's axis-aligned edges need only their corners.
 */
export function lngLatBoxToWorldBox(worldCoordinateHelper: WorldCoordinateHelper, west: number, south: number, east: number, north: number): ProjectedBox {
    return projectBoxEdges((lng, lat) => worldCoordinateHelper.worldFromLngLat(lng, lat), west, south, east, north, 1e-7, !worldCoordinateHelper.wraps);
}

/** Maps a world rectangle back to lng/lat, including extrema along curved CRS edges. */
export function worldBoxToLngLatBox(worldCoordinateHelper: WorldCoordinateHelper, minX: number, minY: number, maxX: number, maxY: number): {west: number; south: number; east: number; north: number} {
    const box = projectBoxEdges((x, y) => {
        const {lng, lat} = worldCoordinateHelper.lngLatFromWorld(x, y);
        return {x: lng, y: lat};
    }, minX, minY, maxX, maxY, 1e-5, !worldCoordinateHelper.wraps);
    return {west: box.minX, south: clamp(box.minY, -90, 90), east: box.maxX, north: clamp(box.maxY, -90, 90)};
}
