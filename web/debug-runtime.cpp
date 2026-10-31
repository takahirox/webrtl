// Lazy CXXRTL introspection. Never called by the Fast execution loop.
#include <vector>
#include <string>
static cxxrtl::debug_items debugger_items;
struct debug_part { std::string name; cxxrtl::debug_item *item; };
static std::vector<debug_part> debug_parts;
static bool debug_loaded;
static void load_debug() {
    if (debug_loaded) return;
    model.debug_info(&debugger_items, nullptr, "");
    for (auto &entry : debugger_items.table)
        for (auto &part : entry.second) debug_parts.push_back({entry.first, &part});
    debug_loaded = true;
}
static cxxrtl::debug_item &find_debug_item(unsigned id) {
    load_debug();
    if (id >= debug_parts.size()) __builtin_trap();
    return *debug_parts[id].item;
}
extern "C" {
unsigned sim_debug_count() { load_debug(); return debug_parts.size(); }
const char *sim_debug_name(unsigned id) { find_debug_item(id); return debug_parts[id].name.c_str(); }
unsigned sim_debug_width(unsigned id) { return find_debug_item(id).width; }
unsigned sim_debug_depth(unsigned id) { return find_debug_item(id).depth; }
unsigned sim_debug_flags(unsigned id) { return find_debug_item(id).flags; }
unsigned sim_debug_type(unsigned id) { return find_debug_item(id).type; }
int sim_debug_lsb(unsigned id) { return static_cast<int>(find_debug_item(id).lsb_at); }
int sim_debug_zero(unsigned id) { return static_cast<int>(find_debug_item(id).zero_at); }
unsigned sim_debug_read(unsigned id, unsigned row, unsigned word) {
    auto &item = find_debug_item(id);
    unsigned words = (item.width + 31) / 32;
    if (row >= item.depth || word >= words) __builtin_trap();
    if (item.outline) item.outline->eval();
    unsigned value = item.curr[row * words + word];
    if (word + 1 == words && item.width % 32) value &= (1u << (item.width % 32)) - 1;
    return value;
}
void sim_debug_input(unsigned id, unsigned word, unsigned value) {
    auto &item = find_debug_item(id);
    if (!(item.flags & cxxrtl::debug_item::INPUT) || !item.next ||
        word >= (item.width + 31) / 32) __builtin_trap();
    item.next[word] = value;
    if (item.curr != item.next) item.curr[word] = value;
}
void sim_debug_settle() { model.step(); }
}
static constexpr unsigned history_capacity = 256, selected_capacity = 16;
static unsigned selected_ids[selected_capacity], selected_rows[selected_capacity], selected_count;
static uint32_t history[history_capacity * (selected_capacity + 1)];
static unsigned history_count;
static int break_id = -1;
static unsigned break_row, break_kind, break_value, break_hit;
extern "C" {
void sim_debug_clear() { selected_count = history_count = break_hit = 0; break_id = -1; }
void sim_debug_select(unsigned id, unsigned row) {
    auto &item = find_debug_item(id);
    if (selected_count >= selected_capacity || item.width > 32 || row >= item.depth) __builtin_trap();
    selected_ids[selected_count] = id; selected_rows[selected_count++] = row;
}
void sim_debug_break(unsigned id, unsigned row, unsigned kind, unsigned value) {
    auto &item = find_debug_item(id);
    if (item.width > 32 || row >= item.depth || kind > 3) __builtin_trap();
    break_id = id; break_row = row; break_kind = kind; break_value = value;
}
unsigned sim_debug_batch(unsigned cycles) {
    if (cycles > 16384) __builtin_trap();
    sample_count = trace_count = history_count = break_hit = 0;
    frame_ready = false;
    unsigned previous = break_id < 0 ? 0 : sim_debug_read(break_id, break_row, 0);
    unsigned completed = 0;
    for (; completed < cycles;) {
        tick<true>();
        ++completed;
        if (selected_count) {
            unsigned slot = history_count++ % history_capacity;
            history[slot * (selected_capacity + 1)] = cycle_count;
            for (unsigned j = 0; j < selected_count; ++j)
                history[slot * (selected_capacity + 1) + j + 1] = sim_debug_read(selected_ids[j], selected_rows[j], 0);
        }
        if (break_id >= 0) {
            unsigned value = sim_debug_read(break_id, break_row, 0);
            bool hit = break_kind == 0 ? value == break_value : break_kind == 1 ? value != previous :
                break_kind == 2 ? previous == 0 && value != 0 : previous != 0 && value == 0;
            previous = value;
            if (hit) { break_hit = 1; break; }
        }
    }
    return completed;
}
uint32_t *sim_debug_history() { return history; }
unsigned sim_debug_history_count() { return history_count; }
unsigned sim_debug_hit() { return break_hit; }
}
