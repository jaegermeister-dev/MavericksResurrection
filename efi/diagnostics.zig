const c=@import("common.zig");const u=c.u;
fn choice() !u16 {
    const con=u.system_table.con_in orelse return error.NoKeyboard;
    while(true){_=con.readKeyStroke() catch |err| {if(err==error.NotReady)break;return err;};}
    while(true){const k=con.readKeyStroke() catch |err| {if(err==error.NotReady){try (try c.bs()).stall(10000);continue;}return err;};
        if(k.scan_code==0x17 or k.unicode_char=='3')return '3';
        if(k.unicode_char=='1' or k.unicode_char=='2')return k.unicode_char;
    }
}
fn run() !void {
    c.print("MavericksResurrection - advanced EFI diagnostics\r\n1) Collect diagnostics only\r\n2) Collect diagnostics, then attempt selected Mavericks boot\r\n3) Exit\r\nChoose 1, 2 or 3: ");
    const mode=try choice();if(mode=='3')return;
    try c.init(if(mode=='1')"hardware" else "boot");
    try c.save("MODE.txt",if(mode=='1')"Diagnostics only. No OS boot requested.\r\n" else "Diagnostics followed by a separately confirmed OS boot attempt.\r\n");
    try @import("hardware.zig").capture();
    if(mode=='2')try @import("boot.zig").attempt();
}
pub fn main() u.Status {
    run() catch |err| return c.fail(err);
    c.close();c.print("Returned to OpenShell. Collect the saved report from MavericksResurrection in your working macOS.\r\n");return .success;
}
