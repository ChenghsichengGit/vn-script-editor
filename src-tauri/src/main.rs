// 打包版不要多開一個黑色的命令列視窗
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vn_script_editor_lib::run()
}
