const std = @import("std");
const zhl = @import("zhl");
const grammars = @import("zhl_grammars");

const line = "pub fn main() void { return 42; }";

const MockParserAdapter = struct {
    pub fn captures(_: @This(), source: []const u8, scratch: *[2]zhl.tree_sitter.Capture) zhl.HighlightError![]const zhl.tree_sitter.Capture {
        const main_start = std.mem.indexOf(u8, source, "main") orelse return error.MalformedGrammar;
        const number_start = std.mem.indexOf(u8, source, "42") orelse return error.MalformedGrammar;
        scratch[0] = .{
            .start = @intCast(main_start),
            .end = @intCast(main_start + 4),
            .style_id = zhl.tree_sitter.styleFromCaptureName("@function"),
            .language_id = 7,
        };
        scratch[1] = .{
            .start = @intCast(number_start),
            .end = @intCast(number_start + 2),
            .style_id = zhl.tree_sitter.styleFromCaptureName("@number"),
            .language_id = 7,
        };
        return scratch;
    }
};

pub fn main() !void {
    const Highlighter = zhl.Engine(grammars.zig_0_16.grammar, .{});
    var highlighter = Highlighter.init(.{});
    var scratch = Highlighter.Scratch.init();
    var base = zhl.sinks.TokenBuffer(32).init();
    _ = try highlighter.highlightLine(line, Highlighter.State.initial(), &scratch, &base);

    var capture_scratch: [2]zhl.tree_sitter.Capture = undefined;
    var overlaid = zhl.sinks.TokenBuffer(32).init();
    _ = try zhl.tree_sitter.applyAdapterLine(line, base.slice(), MockParserAdapter{}, &capture_scratch, &overlaid);

    if (!hasToken(overlaid.slice(), "main", .function, 7)) return error.ExampleFailed;
    if (!hasToken(overlaid.slice(), "42", .number_integer, 7)) return error.ExampleFailed;
    std.debug.print("tree-sitter overlay example ok tokens={d}\n", .{overlaid.count});
}

fn hasToken(tokens: []const zhl.Token, needle: []const u8, style_id: zhl.StyleId, language_id: zhl.tree_sitter.LanguageId) bool {
    const start = std.mem.indexOf(u8, line, needle) orelse return false;
    const end = start + needle.len;
    for (tokens) |tok| {
        if (tok.start <= start and tok.end >= end and tok.style_id == style_id and tok.language_id == language_id) return true;
    }
    return false;
}
