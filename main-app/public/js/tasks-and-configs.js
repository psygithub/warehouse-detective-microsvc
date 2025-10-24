window.sectionInitializers = window.sectionInitializers || {};
window.sectionInitializers['tasks-and-configs'] = async () => {
    await loadConfigs();
    await loadSchedules();
    await loadConfigsForSelect();
    setupForms();
};
