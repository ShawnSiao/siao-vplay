use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleBurnStyle {
    pub text_size: SubtitleBurnTextSize,
    pub position_y: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SubtitleBurnTextSize {
    Small,
    Medium,
    Large,
}

pub(crate) fn subtitle_force_style(style: SubtitleBurnStyle) -> String {
    let font_size = match style.text_size {
        SubtitleBurnTextSize::Small => 8,
        SubtitleBurnTextSize::Medium => 10,
        SubtitleBurnTextSize::Large => 13,
    };
    // libass converts plain SRT through a 384x288 ASS canvas. Mapping the player's
    // normalized position prevents output-resolution scaling from enlarging captions.
    let margin_v = (((1.0 - style.position_y) * 288.0).round() as i32).clamp(6, 260);
    format!(
        "FontName=Microsoft YaHei,FontSize={font_size},PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=1,Shadow=0,MarginV={margin_v},Alignment=2"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_player_caption_size_and_position_to_libass_canvas() {
        let standard = subtitle_force_style(SubtitleBurnStyle {
            text_size: SubtitleBurnTextSize::Medium,
            position_y: 0.96,
        });
        assert!(standard.contains("FontSize=10"), "{standard}");
        assert!(standard.contains("Outline=1"), "{standard}");
        assert!(standard.contains("MarginV=12"), "{standard}");
        assert!(!standard.contains("FontSize=20"), "{standard}");

        let large = subtitle_force_style(SubtitleBurnStyle {
            text_size: SubtitleBurnTextSize::Large,
            position_y: 0.9,
        });
        assert!(large.contains("FontSize=13"), "{large}");
        assert!(large.contains("MarginV=29"), "{large}");
    }
}
