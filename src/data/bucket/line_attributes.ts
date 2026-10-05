import {createLayout, type StructArrayLayout, type StructArrayMember} from '../../util/struct_array.ts';

/** Interleaved line attributes, aligned to four bytes to avoid slow vertex fetches on macOS. */
export const lineLayoutAttributes: StructArrayLayout = createLayout([
    {name: 'a_pos_normal', components: 2, type: 'Int16'},
    {name: 'a_data', components: 4, type: 'Uint8'},
    {name: 'a_offset_normal', components: 2, type: 'Int8'}
], 4);

export const members: StructArrayMember[] = lineLayoutAttributes.members;
export const size: number = lineLayoutAttributes.size;
export const alignment: number = lineLayoutAttributes.alignment;
