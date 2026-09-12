use super::*;
impl LocalResourceManager {
    pub(super) fn mutate<T>(&mut self, operation: impl FnOnce(&mut Self) -> Result<T, LocalResourceError>) -> Result<T, LocalResourceError> {
        let _usage = self.storage.as_ref().map(|storage| storage.acquire_usage()).transpose()
            .map_err(|_| io::Error::other("存储目录正在迁移或等待重启，暂时无法修改资源设置；迁移完成后请重启应用"))?;
        if recover_transactions(&self.config_path)? {
            self.configuration = persistence::load_configuration(&self.config_path)?;
        }
        operation(self)
    }
}
