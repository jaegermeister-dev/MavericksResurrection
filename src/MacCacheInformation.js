/* Mavericks writes IOKit XML with references and a trailing NUL for personalities,
 * but a regular (often binary) property list for OSBundleHelper. Read both using
 * their actual formats. This module inspects bytes only; it never runs a tool.
 */
var MavericksResurrectionMacCacheInformation = (function () {
    'use strict';
    ObjC.import('Foundation');
    function inspect(filename, data) {
        if (!data || Number(data.length) < 8 || Number(data.length) > 33554432) throw new Error('Invalid information cache size.');
        if (filename === 'KextPropertyValues_OSBundleHelper_x86_64.plist.gz') {
            var value = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, 0, null, null);
            if (!value || value.isNil()) throw new Error('Invalid OSBundleHelper property list.');
            var entries = ObjC.deepUnwrap(value);
            if (!Array.isArray(entries) || entries.length > 100000 || entries.some(function (e) { return !e || typeof e !== 'object' || Array.isArray(e); })) throw new Error('Unexpected OSBundleHelper property list entries.');
            return {format: 'property-list', entries: entries.length};
        }
        if (filename !== 'IOKitPersonalities_x86_64.ioplist.gz') throw new Error('Unexpected information cache filename.');
        var string = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
        if (!string || string.isNil()) throw new Error('Invalid IOKit cache text.');
        var text = ObjC.unwrap(string).replace(/\x00$/, '');
        // IOKit emits no DTD or entity declarations. Never permit external input.
        if (/\x00|<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Unexpected IOKit cache declaration or embedded NUL.');
        var doc = $.NSXMLDocument.alloc.initWithDataOptionsError($(text).dataUsingEncoding($.NSUTF8StringEncoding), $.NSXMLNodeLoadExternalEntitiesNever, null);
        if (!doc || doc.isNil()) throw new Error('Invalid IOKit cache XML.');
        function name(node) { return ObjC.unwrap(node.name); }
        function content(node) { return ObjC.unwrap(node.stringValue); }
        function attribute(node, key) { var a = node.attributeForName($(key)); return a && !a.isNil() ? content(a) : null; }
        function children(node) {
            var list = [], count = Number(node.childCount);
            for (var i = 0; i < count; i++) { var child = node.childAtIndex(i); if (Number(child.kind) === Number($.NSXMLElementKind)) list.push(child); }
            return list;
        }
        var ids = Object.create(null), nodes = [], visited = 0;
        function index(node, depth) {
            if (++visited > 1000000 || depth > 128) throw new Error('IOKit cache is too complex.');
            var kind = name(node), id = attribute(node, 'ID'), reference = attribute(node, 'IDREF');
            if (['array', 'dict', 'key', 'string', 'integer', 'data', 'true', 'false'].indexOf(kind) < 0) throw new Error('Unexpected IOKit cache element.');
            if ((id !== null && !/^[0-9]+$/.test(id)) || (reference !== null && !/^[0-9]+$/.test(reference))) throw new Error('Invalid IOKit cache identifier.');
            if (id !== null) { if (ids[id] || reference !== null) throw new Error('Duplicate or conflicting IOKit cache identifier.'); ids[id] = node; }
            if (reference !== null && (children(node).length || content(node))) throw new Error('IOKit reference contains a value.');
            nodes.push(node); children(node).forEach(function (child) { index(child, depth + 1); });
        }
        function resolve(node) {
            var seen = Object.create(null), expected = name(node);
            for (var i = 0; i < 128; i++) {
                var ref = attribute(node, 'IDREF');
                if (ref === null) { if (name(node) !== expected) throw new Error('IOKit reference type differs.'); return node; }
                if (seen[ref] || !ids[ref]) throw new Error('Missing or cyclic IOKit reference.');
                seen[ref] = true; node = ids[ref];
            }
            throw new Error('IOKit reference chain is too long.');
        }
        function dictionary(node) {
            node = resolve(node);
            if (name(node) !== 'dict') throw new Error('Expected an IOKit cache dictionary.');
            var result = Object.create(null), list = children(node);
            if (list.length % 2) throw new Error('Unpaired IOKit dictionary key.');
            for (var i = 0; i < list.length; i += 2) {
                var key = resolve(list[i]), label = content(key);
                if (name(key) !== 'key' || !label || result[label]) throw new Error('Invalid or duplicate IOKit dictionary key.');
                result[label] = resolve(list[i + 1]);
            }
            return result;
        }
        var root = doc.rootElement;
        if (!root || root.isNil() || name(root) !== 'array') throw new Error('Expected an IOKit personality array.');
        index(root, 0);
        nodes.forEach(function (node) { var n = resolve(node); if (name(n) === 'dict') dictionary(n); });
        var personalities = children(root).map(function (node) {
            var values = dictionary(node);
            function field(key, optional) {
                var value = values[key];
                if (!value && optional) return null;
                if (!value || name(value) !== 'string' || !content(value)) throw new Error('Missing IOKit personality field: ' + key);
                return content(value);
            }
            return {bundleID: field('CFBundleIdentifier'), ioClass: field('IOClass'), providerClass: field('IOProviderClass'), publisher: field('IOPersonalityPublisher', true)};
        });
        if (!personalities.length || personalities.length > 100000) throw new Error('Missing or oversized IOKit personalities.');
        return {format: 'iokit-xml', entries: personalities.length, personalities: personalities};
    }
    return {inspect: inspect};
}());
