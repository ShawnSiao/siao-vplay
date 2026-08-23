use std::collections::BTreeMap;

use regex::Regex;

use super::model::{
    AnalysisScope, EvidenceKind, SummaryCitation, SummaryEvidence, SummarySection, SummaryTask,
    VideoSummary,
};

pub(crate) fn render(
    project_title: &str,
    summary: &VideoSummary,
    task: &SummaryTask,
    assets: &BTreeMap<String, String>,
) -> String {
    let mut markdown = format!(
        "# {}\n\n## 分析范围\n\n- 视频：{}\n- 范围：{}\n- 截止点：{}\n- 字幕版本：`{}`\n- 分析模式：`{:?}`\n- 执行方式：`{:?}`\n- 服务与模型：{} / {}\n- 提示词模板：{}\n- AI 实际使用视觉材料：{}\n\n## 讲者到底讲了什么\n\n{}\n",
        safe(&summary.result.title),
        safe(project_title),
        if summary.scope == AnalysisScope::FullVideo {
            "完整视频"
        } else {
            "截至当前进度"
        },
        summary
            .playback_cutoff_ms
            .map(format_time)
            .unwrap_or_else(|| "完整视频".to_owned()),
        summary.subtitle_version_id,
        summary.analysis_mode,
        task.execution_kind,
        task.provider_id.as_deref().unwrap_or("本机"),
        task.model_id.as_deref().unwrap_or("未记录"),
        safe(&task.prompt_snapshot.template_name),
        if summary.visual_material_used {
            "是"
        } else {
            "否"
        },
        safe(&summary.result.overview),
    );
    render_sections(&mut markdown, "讲述脉络", &summary.result.speaker_narrative);
    render_sections(&mut markdown, "时间线", &summary.result.timeline);
    render_sections(&mut markdown, "核心概念", &summary.result.core_concepts);
    render_sections(
        &mut markdown,
        "原理或架构",
        &summary.result.principles_or_architecture,
    );
    render_sections(
        &mut markdown,
        "具体例子与适用场景",
        &summary.result.examples_and_scenarios,
    );
    render_sections(
        &mut markdown,
        "设计权衡与边界",
        &summary.result.design_tradeoffs,
    );
    if let Some(mermaid) = summary
        .result
        .mermaid
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        markdown.push_str(&format!("\n```mermaid\n{}\n```\n", safe(mermaid)));
    }
    render_sections(&mut markdown, "行动结论", &summary.result.conclusions);
    markdown.push_str("\n## 局限与待验证\n\n");
    for limitation in &summary.result.limitations {
        markdown.push_str(&format!("- {}\n", safe(limitation)));
    }
    markdown.push_str("\n## 术语表\n\n");
    for entry in &summary.result.glossary {
        markdown.push_str(&format!(
            "- **{}**：{}{}\n",
            safe(&entry.term),
            safe(&entry.explanation),
            render_citations(&entry.citations, entry.subtitle_ids.len())
        ));
    }
    if !assets.is_empty() {
        markdown.push_str("\n## 代表性画面\n\n");
        for name in assets.keys() {
            markdown.push_str(&format!("![代表性画面](assets/{name})\n\n"));
        }
    }
    markdown.push_str(
        "\n> 说明：视频中的主张不等于外部已验证事实；「AI 推导」与「待外部验证」应单独核验。\n",
    );
    markdown
}

fn render_sections(output: &mut String, heading: &str, sections: &[SummarySection]) {
    if sections.is_empty() {
        return;
    }
    output.push_str(&format!("\n## {heading}\n\n"));
    for section in sections {
        output.push_str(&format!(
            "### {}\n\n{}\n",
            safe(&section.title),
            safe(&section.body)
        ));
        if section.evidence.is_empty() {
            continue;
        }
        output.push_str(&format!(
            "\n<details>\n<summary>依据与推导（{} 项）</summary>\n\n",
            section.evidence.len()
        ));
        for evidence in &section.evidence {
            render_evidence(output, evidence);
        }
        output.push_str("\n</details>\n");
    }
}

fn render_evidence(output: &mut String, evidence: &SummaryEvidence) {
    output.push_str(&format!(
        "- **{}**：{}",
        evidence_label(evidence.kind),
        safe(&evidence.claim)
    ));
    output.push_str(&render_citations(
        &evidence.citations,
        evidence.subtitle_ids.len(),
    ));
    if !evidence.frame_timestamps_ms.is_empty() {
        output.push_str(&format!(
            "（画面：{}）",
            evidence
                .frame_timestamps_ms
                .iter()
                .map(|value| format_time(*value))
                .collect::<Vec<_>>()
                .join("、")
        ));
    }
    output.push('\n');
}

fn evidence_label(kind: EvidenceKind) -> &'static str {
    match kind {
        EvidenceKind::VideoStatement => "视频明确陈述",
        EvidenceKind::SubtitleOrFrame => "字幕或画面证据",
        EvidenceKind::AiInference => "AI 推导",
        EvidenceKind::NeedsExternalValidation => "待外部验证",
    }
}

fn render_citations(citations: &[SummaryCitation], subtitle_count: usize) -> String {
    if citations.is_empty() {
        return if subtitle_count == 0 {
            String::new()
        } else {
            format!("（{subtitle_count} 条字幕证据）")
        };
    }
    format!(
        "（{}）",
        citations
            .iter()
            .map(|citation| format!(
                "{}–{} · {} 条字幕",
                format_time(citation.start_ms),
                format_time(citation.end_ms),
                citation.subtitle_count
            ))
            .collect::<Vec<_>>()
            .join("；")
    )
}

fn safe(value: &str) -> String {
    let windows_path = Regex::new(r"(?i)[a-z]:\\[^\s\]\[()<>]+").expect("path pattern");
    let key = Regex::new(r"(?i)(sk|api[_-]?key)[-_:= ]?[a-z0-9]{12,}").expect("key pattern");
    key.replace_all(
        &windows_path.replace_all(value, "[本机路径已隐藏]"),
        "[凭证已隐藏]",
    )
    .into_owned()
}

fn format_time(milliseconds: i64) -> String {
    format!(
        "{:02}:{:02}:{:02}",
        milliseconds / 3_600_000,
        milliseconds / 60_000 % 60,
        milliseconds / 1_000 % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_paths_and_credentials() {
        let value = safe("见 E:\\private\\video.mp4 key sk-abcdefghijklmnop");
        assert!(!value.contains("private"));
        assert!(!value.contains("abcdefghijklmnop"));
    }

    #[test]
    fn renders_readable_citations_without_internal_ids() {
        let evidence = SummaryEvidence {
            kind: EvidenceKind::VideoStatement,
            claim: "讲者解释了检索过程".into(),
            subtitle_ids: vec!["private-uuid".into()],
            frame_timestamps_ms: vec![],
            citations: vec![SummaryCitation {
                start_ms: 12_000,
                end_ms: 18_000,
                subtitle_count: 3,
                excerpt: "字幕摘录".into(),
            }],
        };
        let mut output = String::new();
        render_evidence(&mut output, &evidence);
        assert!(output.contains("00:00:12–00:00:18 · 3 条字幕"));
        assert!(!output.contains("private-uuid"));
    }
}
