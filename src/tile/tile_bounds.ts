import {LngLatBounds, type LngLatBoundsLike} from '../geo/lng_lat_bounds.ts';
import {lngLatBoxToWorldBox} from '../geo/projection/mercator_utils.ts';

import type {WorldCoordinateHelper} from '../geo/transform_interface.ts';
import type {CanonicalTileID} from './tile_id.ts';

export class TileBounds {
    bounds: LngLatBounds;
    minzoom: number;
    maxzoom: number;
    /** `bounds` in the world square of `_worldCoordinateHelper`. */
    private _worldBox: {minX: number; minY: number; maxX: number; maxY: number};
    /** The projection `_worldBox` is in: the one given to the constructor, or to the last `contains` that differed. */
    private _worldCoordinateHelper: WorldCoordinateHelper;

    constructor(bounds: [number, number, number, number], minzoom: number | null | undefined, maxzoom: number | null | undefined, worldCoordinateHelper: WorldCoordinateHelper) {
        this.bounds = LngLatBounds.convert(this.validateBounds(bounds));
        this.minzoom = minzoom || 0;
        this.maxzoom = maxzoom || 24;
        this._projectBounds(worldCoordinateHelper);
    }

    /**
     * Projects `bounds` into the world square of a projection. Projecting a box samples it on a grid, so the result
     * is kept until the projection changes.
     */
    private _projectBounds(worldCoordinateHelper: WorldCoordinateHelper): void {
        this._worldCoordinateHelper = worldCoordinateHelper;
        this._worldBox = lngLatBoxToWorldBox(worldCoordinateHelper, this.bounds.getWest(), this.bounds.getSouth(), this.bounds.getEast(), this.bounds.getNorth());
    }

    validateBounds(bounds: [number, number, number, number]): LngLatBoundsLike {
        // make sure the bounds property contains valid longitude and latitudes
        if (!Array.isArray(bounds) || bounds.length !== 4) return [-180, -90, 180, 90];
        return [Math.max(-180, bounds[0]), Math.max(-90, bounds[1]), Math.min(180, bounds[2]), Math.min(90, bounds[3])];
    }

    /**
     * Whether a tile of the grid of `worldCoordinateHelper`, the map's projection, overlaps `bounds`. A source keeps
     * its bounds across `setProjection` because a different projection than last time projects them again.
     */
    contains(tileID: CanonicalTileID, worldCoordinateHelper: WorldCoordinateHelper = this._worldCoordinateHelper): boolean {
        if (worldCoordinateHelper !== this._worldCoordinateHelper) this._projectBounds(worldCoordinateHelper);
        const worldSize = Math.pow(2, tileID.z);
        const level = {
            minX: Math.floor(this._worldBox.minX * worldSize),
            minY: Math.floor(this._worldBox.minY * worldSize),
            maxX: Math.ceil(this._worldBox.maxX * worldSize),
            maxY: Math.ceil(this._worldBox.maxY * worldSize)
        };
        return tileID.x >= level.minX && tileID.x < level.maxX && tileID.y >= level.minY && tileID.y < level.maxY;
    }
}
