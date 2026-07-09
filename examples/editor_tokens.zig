const std = @import("std");
const zhl = @import("zhl");
const grammars = @import("zhl_grammars");

const source = "@dataclass";

const EditorToken = struct {
    start: u32,
    end: u32,
    style_id: zhl.StyleId,
    language_id: u16,
};

pub fn main() !void {
    const metadata = grammars.findByExtension("py") orelse return error.ExampleFailed;
    if (metadata.id != .python) return error.ExampleFailed;

    const Highlighter = zhl.Engine(grammars.python.grammar, .{});
    var highlighter = Highlighter.init(.{});
    var scratch = Highlighter.Scratch.init();
    var sink = zhl.sinks.TokenBuffer(8).init();
    _ = try highlighter.highlightLine(source, Highlighter.State.initial(), &scratch, &sink);

    var editor_tokens: [8]EditorToken = undefined;
    const count = try toEditorTokens(sink.slice(), @intFromEnum(metadata.id), &editor_tokens);
    if (count != 1) return error.ExampleFailed;
    if (editor_tokens[0].style_id != .function) return error.ExampleFailed;
    if (editor_tokens[0].language_id != @intFromEnum(grammars.LanguageId.python)) return error.ExampleFailed;

    std.debug.print("editor token example ok tokens={d} language={s}\n", .{ count, metadata.canonical });
}

fn toEditorTokens(tokens: []const zhl.Token, language_id: u16, out: []EditorToken) !usize {
    if (tokens.len > out.len) return error.TokenOverflow;
    for (tokens, 0..) |token, i| {
        out[i] = .{
            .start = token.start,
            .end = token.end,
            .style_id = token.style_id,
            .language_id = language_id,
        };
    }
    return tokens.len;
}
