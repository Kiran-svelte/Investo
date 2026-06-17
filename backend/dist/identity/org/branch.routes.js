"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const rbac_1 = require("../../middleware/rbac");
const branch_service_1 = require("../org/branch.service");
const branchScope_service_1 = require("../org/branchScope.service");
const router = (0, express_1.Router)();
router.use(auth_1.authenticate);
router.use((0, rbac_1.hasRole)('company_admin'));
router.get('/', async (req, res) => {
    const companyId = req.user.company_id;
    const branches = await branch_service_1.branchService.list(companyId);
    const branchIds = branches.map((branch) => branch.id);
    const memberCounts = await (0, branchScope_service_1.countBranchMembers)(companyId, branchIds);
    const tree = branch_service_1.branchService.buildTree(branches);
    res.json({ data: branch_service_1.branchService.attachMemberCounts(tree, memberCounts) });
});
router.post('/', async (req, res) => {
    try {
        const branch = await branch_service_1.branchService.create(req.user.company_id, {
            name: req.body?.name,
            parent_id: req.body?.parent_id || null,
            settings: req.body?.settings,
        });
        res.status(201).json({ data: branch });
    }
    catch (err) {
        res.status(400).json({ error: err.message || 'Failed to create branch' });
    }
});
router.patch('/:id', async (req, res) => {
    try {
        const branch = await branch_service_1.branchService.update(req.user.company_id, req.params.id, {
            name: req.body?.name,
            parent_id: req.body?.parent_id,
            settings: req.body?.settings,
        });
        res.json({ data: branch });
    }
    catch (err) {
        res.status(400).json({ error: err.message || 'Failed to update branch' });
    }
});
router.delete('/:id', async (req, res) => {
    try {
        await branch_service_1.branchService.remove(req.user.company_id, req.params.id);
        res.status(204).send();
    }
    catch (err) {
        res.status(400).json({ error: err.message || 'Failed to delete branch' });
    }
});
exports.default = router;
