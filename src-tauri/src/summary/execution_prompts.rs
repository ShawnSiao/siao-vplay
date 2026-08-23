use crate::{store::StoreError, subtitles::SubtitleSegment};

use super::model::{SummaryResult, SummaryTask};

pub(crate) fn chunk(
    task: &SummaryTask,
    ordinal: usize,
    material: &[&SubtitleSegment],
) -> Result<String, StoreError> {
    let json = serde_json::to_string(material)
        .map_err(|error| StoreError::Validation(error.to_string()))?;
    Ok(format!(
        "{}\n\n分析模式：{:?}\n这是第 {} 个字幕分块。前置字幕仅为理解上下文，不计入本块覆盖率。\n\n必须输出 formatVersion=2，coveredChunkOrdinals 只能是 [{}]。不要把字幕逐句改写成列表，也不要生成泛泛的一句话摘要。请保留足够细节供最终长文综合：\n1. speakerNarrative 按讲述顺序写清楚讲者或人物具体说了什么、如何推进论述；\n2. coreConcepts 解释术语含义、作用及相互关系；\n3. principlesOrArchitecture 记录机制步骤、组件职责、数据流或因果关系；\n4. examplesAndScenarios 提取视频中的例子、类比、演示和适用场景；\n5. designTradeoffs 提取限制、取舍、反例和未解决问题；\n6. 每个正文段落应形成完整解释，并引用本块有效字幕 ID。未出现的类别返回空数组，不得编造。\n\n授权字幕 JSON：\n{}",
        task.prompt_snapshot.composed_prompt,
        task.analysis_mode,
        ordinal + 1,
        ordinal + 1,
        json
    ))
}

pub(crate) fn final_synthesis(
    task: &SummaryTask,
    results: &[SummaryResult],
) -> Result<String, StoreError> {
    let json = serde_json::to_string(results)
        .map_err(|error| StoreError::Validation(error.to_string()))?;
    let covered = (1..=results.len()).collect::<Vec<_>>();
    Ok(format!(
        r#"{}

只综合下列已经校验的分块结果，不读取原始字幕或其他材料。必须输出 formatVersion=2，coveredChunkOrdinals 必须精确为 {:?}。

目标不是粗略摘要，而是一份可以保存和连续阅读的详细视频解读：
- overview 用 3 至 5 个完整段落回答‘讲者到底讲了什么’，说明核心论点、展开路径和最终结论；
- speakerNarrative 按主题或章节还原讲述脉络，写清人物或讲者提出的问题、论据、解释和转折；
- coreConcepts 解释关键知识，不只列定义，还要说明作用、关系和为何重要；
- principlesOrArchitecture 详细描述原理步骤、组件职责、数据流、因果链或系统边界；
- examplesAndScenarios 单独说明视频中的例子、演示、类比、使用场景及例子证明了什么；如果全部分块都没有这类内容，返回空数组并在 limitations 说明视频未提供具体例子，不得编造；
- designTradeoffs 说明限制、设计权衡、反例、风险和待外部验证内容；
- conclusions 给出从视频材料可得出的结论，不把视频主张冒充外部事实；
- 软件架构内容可给 Mermaid，但正文必须独立完整，不能用图替代解释。

合并重复论点，但不要因合并而丢失细节。每个章节正文应为有逻辑的长段落，避免‘视频介绍了……’式空泛句。每个分块都必须至少保留一条有效字幕证据。保留内部证据 ID 供系统校验，不要输出 citations 字段，播放器会在本机将 ID 转换为时间范围和短摘录。

已校验分块结果：
{}"#,
        task.prompt_snapshot.composed_prompt, covered, json
    ))
}
