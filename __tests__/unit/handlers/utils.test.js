const utils = require('../../../src/common/utils');

describe('Tests for utils', () => {
    it('base64ToString should correctly decode a base64 string to a string', () => {
        const originalString = "hello world";
        const base64Encoded = utils.stringToBase64(originalString);
        const expected = originalString;
        const result = utils.base64ToString(base64Encoded);
        expect(result).toBe(expected);
    });

    it('stringToBase64 should correctly encode a string to base64', () => {
        const originalString = "hello world";
        const expected = 'aGVsbG8gd29ybGQ=';
        const result = utils.stringToBase64(originalString);
        expect(result).toBe(expected);
    });
});