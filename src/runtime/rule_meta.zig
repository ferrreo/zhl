const std = @import("std");
const ByteMask256 = @import("../ByteMask256.zig");
const regex_escape = @import("../regex/escape.zig");
const scan = @import("scan.zig");

pub fn regexMayStartIdentifier(comptime value: []const u8) bool {
    if (regexLiteralStart(value)) |byte| return scan.isIdentStart(byte);
    if (anchoredRegexStartIndex(value)) |start| return regexAtomMayStartIdentifier(value, start);
    return true;
}

pub fn operatorMayStartIdentifier(comptime value: []const u8) bool {
    var i: usize = 0;
    while (i < value.len) {
        while (i < value.len and isSetSpace(value[i])) : (i += 1) {}
        if (i < value.len and scan.isIdentStart(value[i])) return true;
        while (i < value.len and !isSetSpace(value[i])) : (i += 1) {}
    }
    return false;
}

pub fn regexIsAnchored(comptime value: []const u8) bool {
    return (value.len > 0 and value[0] == '^') or std.mem.startsWith(u8, value, "\\A");
}

pub fn regexLineStartOnly(comptime value: []const u8) bool {
    return regexIsAnchored(value) or
        std.mem.startsWith(u8, value, "(?=^") or
        std.mem.startsWith(u8, value, "(?!^") or
        std.mem.startsWith(u8, value, "(?=\\A") or
        std.mem.startsWith(u8, value, "(?!\\A");
}

pub fn wordInSet(comptime set: []const u8, word: []const u8) bool {
    @setEvalBranchQuota(10_000);
    comptime var i: usize = 0;
    inline while (i < set.len) {
        comptime {
            while (i < set.len and isSetSpace(set[i])) i += 1;
        }
        const start = i;
        comptime {
            while (i < set.len and !isSetSpace(set[i])) i += 1;
        }
        if (start < i and std.mem.eql(u8, set[start..i], word)) return true;
    }
    return false;
}

pub fn scanOperatorSet(comptime set: []const u8, line: []const u8, start: usize) usize {
    var best: usize = start;
    const first = line[start];
    const filter_first = comptime operatorCount(set) > 10;
    comptime var i: usize = 0;
    inline while (i < set.len) {
        comptime {
            while (i < set.len and isSetSpace(set[i])) i += 1;
        }
        const op_start = i;
        comptime {
            while (i < set.len and !isSetSpace(set[i])) i += 1;
        }
        if (op_start < i and (!filter_first or set[op_start] == first) and std.mem.startsWith(u8, line[start..], set[op_start..i]) and start + (i - op_start) > best) best = start + (i - op_start);
    }
    return best;
}

fn operatorCount(comptime set: []const u8) usize {
    var count: usize = 0;
    var i: usize = 0;
    while (i < set.len) {
        while (i < set.len and isSetSpace(set[i])) : (i += 1) {}
        if (i < set.len) count += 1;
        while (i < set.len and !isSetSpace(set[i])) : (i += 1) {}
    }
    return count;
}

pub fn setOperatorStarts(comptime value: []const u8, mask: *ByteMask256) void {
    var i: usize = 0;
    while (i < value.len) {
        while (i < value.len and isSetSpace(value[i])) : (i += 1) {}
        if (i < value.len) mask.set(value[i]);
        while (i < value.len and !isSetSpace(value[i])) : (i += 1) {}
    }
}

pub fn setRegexStarts(comptime value: []const u8, mask: *ByteMask256) void {
    if (regexLiteralStart(value)) |byte| {
        mask.set(byte);
        return;
    }
    if (anchoredRegexStartIndex(value)) |start| {
        setRegexAtomStarts(value, start, mask);
        return;
    }
    for ("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_0123456789@#/\"'") |byte| mask.set(byte);
}

pub fn setRegexStartsNoAnchored(comptime value: []const u8, mask: *ByteMask256) void {
    if (!regexIsAnchored(value)) setRegexStarts(value, mask);
}

fn regexAtomMayStartIdentifier(comptime value: []const u8, comptime start: usize) bool {
    if (start >= value.len) return false;
    if (value[start] == '[') return regexClassMayStartIdentifier(value, start + 1);
    if (value[start] == '\\') return if (escapedRegexStart(value[start..])) |byte| scan.isIdentStart(byte) else true;
    return scan.isIdentStart(value[start]);
}

fn regexClassMayStartIdentifier(comptime value: []const u8, comptime class_start: usize) bool {
    comptime var i = class_start;
    if (i < value.len and value[i] == '^') return true;
    inline while (i < value.len and value[i] != ']') {
        const first = if (value[i] == '\\') escapedRegexStart(value[i..]) orelse return true else value[i];
        if (scan.isIdentStart(first)) return true;
        if (i + 2 < value.len and value[i + 1] == '-' and value[i + 2] != ']') {
            if ((first <= 'Z' and value[i + 2] >= 'A') or (first <= 'z' and value[i + 2] >= 'a') or first <= '_') return true;
            i += 3;
        } else {
            i += if (value[i] == '\\') 2 else 1;
        }
    }
    return false;
}

fn anchoredRegexStartIndex(comptime value: []const u8) ?usize {
    var i: usize = 0;
    if (i < value.len and value[i] == '^') {
        i += 1;
    } else return null;
    while (std.mem.startsWith(u8, value[i..], "\\s*")) i += 3;
    return i;
}

fn setRegexAtomStarts(comptime value: []const u8, comptime start: usize, mask: *ByteMask256) void {
    if (start >= value.len) return;
    if (value[start] == '[') {
        setRegexClassStarts(value, start + 1, mask);
        return;
    }
    if (value[start] == '\\') {
        if (escapedRegexStart(value[start..])) |byte| mask.set(byte);
        return;
    }
    if (std.mem.indexOfScalar(u8, ".^$*+?()|", value[start]) == null) mask.set(value[start]);
}

fn setRegexClassStarts(comptime value: []const u8, comptime class_start: usize, mask: *ByteMask256) void {
    comptime var i = class_start;
    if (i < value.len and value[i] == '^') return;
    inline while (i < value.len and value[i] != ']') {
        const first = if (value[i] == '\\') escapedRegexStart(value[i..]) orelse return else value[i];
        if (i + 2 < value.len and value[i + 1] == '-' and value[i + 2] != ']') {
            const last = value[i + 2];
            if (first <= last) {
                comptime var byte = first;
                inline while (byte <= last) : (byte += 1) mask.set(byte);
            }
            i += 3;
        } else {
            mask.set(first);
            i += if (value[i] == '\\') 2 else 1;
        }
    }
}

pub fn regexLiteralStart(comptime value: []const u8) ?u8 {
    var i: usize = 0;
    var extended = false;
    while (i < value.len) {
        if (extended) {
            while (i < value.len and std.ascii.isWhitespace(value[i])) : (i += 1) {}
            if (i < value.len and value[i] == '#') {
                while (i < value.len and value[i] != '\n') : (i += 1) {}
                continue;
            }
        }
        if (isolatedRegexFlagEnd(value, i)) |next| {
            extended = regexFlagRunSetsExtended(value[i + 2 .. next - 1], extended);
            i = next;
            continue;
        }
        if (value[i] == '^') {
            i += 1;
            continue;
        }
        if (std.mem.startsWith(u8, value[i..], "\\A")) {
            i += 2;
            continue;
        }
        if (value[i] == '\\') return escapedRegexStart(value[i..]);
        return if (std.mem.indexOfScalar(u8, ".^$*+?[]()|", value[i]) == null) value[i] else null;
    }
    return null;
}

fn isolatedRegexFlagEnd(comptime value: []const u8, start: usize) ?usize {
    if (!std.mem.startsWith(u8, value[start..], "(?")) return null;
    var i = start + 2;
    while (i < value.len and std.mem.indexOfScalar(u8, "imx-s", value[i]) != null) : (i += 1) {}
    return if (i > start + 2 and i < value.len and value[i] == ')') i + 1 else null;
}

fn regexFlagRunSetsExtended(comptime run: []const u8, initial: bool) bool {
    var extended = initial;
    var enabled = true;
    for (run) |byte| {
        if (byte == '-') {
            enabled = false;
        } else if (byte == 'x') extended = enabled;
    }
    return extended;
}

fn escapedRegexStart(comptime value: []const u8) ?u8 {
    if (value.len < 2) return null;
    if (value[1] == 'x' or value[1] == 'o' or value[1] == 'u') return if (regex_escape.parseByte(value, 1, value.len)) |parsed| parsed.byte else null;
    return switch (value[1]) {
        'A',
        'b',
        'B',
        'G',
        'z',
        'Z',
        'd',
        'D',
        'h',
        'H',
        'N',
        'O',
        'p',
        'P',
        'R',
        's',
        'S',
        'w',
        'W',
        'K',
        => null,
        'a' => 0x07,
        'e' => 0x1b,
        'f' => 0x0c,
        'n' => '\n',
        'r' => '\r',
        't' => '\t',
        'v' => 0x0b,
        else => value[1],
    };
}

fn isSetSpace(byte: u8) bool {
    return byte == ' ' or byte == '\t' or byte == '\r' or byte == '\n';
}
