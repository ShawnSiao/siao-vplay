use thiserror::Error;

use crate::store::StoreError;

#[derive(Debug, Error)]
pub(crate) enum LibraryError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("媒体库数据库错误：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("媒体库输入无效：{0}")]
    Validation(String),
    #[error("未找到集合：{0}")]
    CollectionNotFound(String),
    #[error("项目不在集合中：collection={collection_id}, project={project_id}")]
    MembershipNotFound {
        collection_id: String,
        project_id: String,
    },
    #[error("项目已在集合中：collection={collection_id}, project={project_id}")]
    MembershipExists {
        collection_id: String,
        project_id: String,
    },
    #[error("媒体库状态冲突：{0}")]
    Conflict(String),
    #[error("媒体库数据库中的值无效：{0}")]
    InvalidData(String),
    #[error("媒体库文件系统错误：{0}")]
    FileSystem(#[from] std::io::Error),
    #[error("媒体库扫描已取消：{0}")]
    ScanCancelled(String),
    #[error("媒体库扫描不存在或已经结束：{0}")]
    ScanNotFound(String),
    #[error("媒体库预览不存在或已经使用：{0}")]
    PreviewNotFound(String),
    #[error("媒体库预览已经过期：{0}")]
    PreviewExpired(String),
}
