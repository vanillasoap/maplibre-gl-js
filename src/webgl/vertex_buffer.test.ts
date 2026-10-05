import {describe, beforeEach, test, expect, vi} from 'vitest';
import {VertexBuffer} from './vertex_buffer.ts';
import {LineLayoutArray, StructArrayLayout3i6} from '../data/array_types.g.ts';
import {members as lineAttributes} from '../data/bucket/line_attributes.ts';
import {Context} from './context.ts';
import {createNullGL} from '../util/test/null_gl.ts';

import type {StructArrayMember} from '../util/struct_array.ts';

describe('VertexBuffer', () => {
    let gl: WebGL2RenderingContext;

    beforeEach(() => {
        gl = createNullGL();
    });

    class TestArray extends StructArrayLayout3i6 {}
    const attributes = [
        {name: 'map', components: 1, type: 'Int16', offset: 0},
        {name: 'box', components: 2, type: 'Int16', offset: 4}
    ] as StructArrayMember[];

    test('constructs itself', () => {
        const context = new Context(gl);
        const array = new TestArray();
        array.emplaceBack(1, 1, 1);
        array.emplaceBack(1, 1, 1);
        array.emplaceBack(1, 1, 1);

        const buffer = new VertexBuffer(context, array, attributes);

        expect(buffer.attributes).toEqual([
            {name: 'map', components: 1, type: 'Int16', offset: 0},
            {name: 'box', components: 2, type: 'Int16', offset: 4}
        ]);
        expect(buffer.itemSize).toBe(6);
        expect(buffer).toHaveLength(3);
    });

    test('enableAttributes', () => {
        const context = new Context(gl);
        const array = new TestArray();
        const buffer = new VertexBuffer(context, array, attributes);
        const spy = vi.spyOn(context.gl, 'enableVertexAttribArray').mockImplementation(() => {});
        buffer.enableAttributes(context.gl, {attributes: {map: {location: 5, isInteger: false}, box: {location: 6, isInteger: false}}} as any);
        expect(spy.mock.calls).toEqual([[5], [6]]);
    });

    test('setVertexAttribPointers', () => {
        const context = new Context(gl);
        const array = new TestArray();
        const buffer = new VertexBuffer(context, array, attributes);
        const spy = vi.spyOn(context.gl, 'vertexAttribPointer').mockImplementation(() => {});
        buffer.setVertexAttribPointers(context.gl, {attributes: {map: {location: 5, isInteger: false}, box: {location: 6, isInteger: false}}} as any, 50);
        expect(spy.mock.calls).toEqual([
            [5, 1, context.gl['SHORT'], false, 6, 300],
            [6, 2, context.gl['SHORT'], false, 6, 304]
        ]);
    });

    test('setVertexAttribPointers uses vertexAttribIPointer for integer attributes', () => {
        const context = new Context(gl);
        const array = new TestArray();
        const buffer = new VertexBuffer(context, array, attributes);
        const integerSpy = vi.spyOn(context.gl, 'vertexAttribIPointer').mockImplementation(() => {});
        const floatSpy = vi.spyOn(context.gl, 'vertexAttribPointer').mockImplementation(() => {});
        buffer.setVertexAttribPointers(context.gl, {attributes: {map: {location: 5, isInteger: false}, box: {location: 6, isInteger: true}}} as any, 50);
        expect(integerSpy.mock.calls).toEqual([
            [6, 2, context.gl['SHORT'], 6, 304]
        ]);
        expect(floatSpy.mock.calls).toEqual([
            [5, 1, context.gl['SHORT'], false, 6, 300]
        ]);
    });

    test('keeps line records and segmented attribute pointers four-byte aligned', () => {
        const context = new Context(gl);
        const array = new LineLayoutArray();
        array.emplaceBack(11, 12, 1, 2, 3, 4, -5, 6);
        array.emplaceBack(-21, 22, 255, 254, 253, 252, 63, -64);
        const originalBuffer = array.arrayBuffer;
        const buffer = new VertexBuffer(context, array, lineAttributes);

        expect(buffer.itemSize % 4).toBe(0);
        expect(vi.mocked(gl.bufferData).mock.lastCall[1]).toBe(originalBuffer);
        const uploaded = new DataView(originalBuffer);
        const offset = buffer.itemSize;
        expect([uploaded.getInt16(offset, true), uploaded.getInt16(offset + 2, true)]).toEqual([-21, 22]);
        expect(Array.from(new Uint8Array(uploaded.buffer, offset + 4, 4))).toEqual([255, 254, 253, 252]);
        expect([uploaded.getInt8(offset + 8), uploaded.getInt8(offset + 9)]).toEqual([63, -64]);

        buffer.setVertexAttribPointers(gl, {attributes: {
            a_pos_normal: {location: 0, isInteger: true},
            a_data: {location: 1, isInteger: true},
            a_offset_normal: {location: 2, isInteger: false}
        }} as any, 1);
        expect(gl.vertexAttribIPointer).toHaveBeenCalledWith(0, 2, gl.SHORT, 12, 12);
        expect(gl.vertexAttribIPointer).toHaveBeenCalledWith(1, 4, gl.UNSIGNED_BYTE, 12, 16);
        expect(gl.vertexAttribPointer).toHaveBeenCalledWith(2, 2, gl.BYTE, false, 12, 20);
    });

    test('static buffer frees StructArray typed views after upload', () => {
        const context = new Context(gl);
        const array = new TestArray();
        array.emplaceBack(1, 2, 3);
        array.emplaceBack(4, 5, 6);

        const originalBuffer = array.arrayBuffer;
        expect(originalBuffer.byteLength).toBeGreaterThan(0);
        expect(array.int16.buffer).toBe(originalBuffer);

        // Static upload (dynamicDraw = false)
        new VertexBuffer(context, array, attributes);

        expect(array.arrayBuffer.byteLength).toBe(0);
        expect(array.int16.buffer).not.toBe(originalBuffer);
        expect(array.int16).toHaveLength(0);
    });

    test('dynamic buffer preserves StructArray data after upload', () => {
        const context = new Context(gl);
        const array = new TestArray();
        array.emplaceBack(1, 2, 3);

        const originalBuffer = array.arrayBuffer;

        // Dynamic upload (dynamicDraw = true)
        new VertexBuffer(context, array, attributes, true);

        // Data should be preserved for future updateData() calls
        expect(array.arrayBuffer).toBe(originalBuffer);
        expect(array.int16.length).toBeGreaterThan(0);
    });

});
