// ==UserScript==
// @name         HNU 教学评价自动填写
// @namespace    https://hdjw.hnu.edu.cn/
// @version      0.1.0
// @description  在学生评价二级页面提供激活按钮，自动完成期终教学评价。
// @match        http://hdjw.hnu.edu.cn/pjxt/evaluate/studentEvaluate/student-jdp/index*
// @match        https://hdjw.hnu.edu.cn/pjxt/evaluate/studentEvaluate/student-jdp/index*
// @match        http://hdjw.hnu.edu.cn/pjxt/evaluate/studentEvaluate/student-jdp/*
// @match        https://hdjw.hnu.edu.cn/pjxt/evaluate/studentEvaluate/student-jdp/*
// @match        *://webvpn2.hnu.edu.cn/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        triggerText: '激活自动评价',
        suggestionText: '无',
        satisfiedText: '非常满意',
        recommendText: '非常愿意',
        viewText: '查看',
        viewEvaluateText: '查看评价',
        editText: '修改',
        evaluateText: '评价',
        submitText: '确认',
        backText: '返回',
        pageTitleKeyword: '阶段评',
        detailWaitMs: 5000,
        subjectiveWaitMs: 45000,
        secondaryRepeatWaitMs: 10000,
        debounceMs: 1200,
        maxRetry: 20,
    };

    let running = false;

    const STORAGE_KEYS = {
        pending: 'hnu-auto-eval-pending',
        entered: 'hnu-auto-eval-entered',
    };

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function getText(el) {
        return (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim();
    }

    function isElementButton(el) {
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'BUTTON' || tag === 'A' || tag === 'SPAN' || tag === 'DIV' || tag === 'LABEL';
    }

    function findClickableByText(text, root = document) {
        const candidates = Array.from(root.querySelectorAll('button, a, label, span, div'));
        return candidates.find((el) => {
            if (!isElementButton(el) || !isVisible(el)) return false;
            const t = getText(el);
            return t === text || t.includes(text);
        }) || null;
    }

    function findRowByText(textList, root = document) {
        const rows = Array.from(root.querySelectorAll('tr, .el-table__row, li, div'));
        return rows.find((row) => {
            const content = getText(row);
            return textList.some((text) => content.includes(text));
        }) || null;
    }

    function clickRadioInRow(row, answerText) {
        if (!row) {
            return false;
        }
        const candidates = Array.from(row.querySelectorAll('label.el-radio, label[role="radio"], label'))
            .filter(isVisible)
            .filter((label) => getText(label).includes(answerText));
        const label = candidates[0];
        if (!label) {
            return false;
        }
        label.click();
        return true;
    }

    function findActionButton(textCandidates, root = document) {
        const buttons = Array.from(root.querySelectorAll('button'));
        return buttons.find((button) => {
            if (!isVisible(button)) return false;
            const text = getText(button);
            return textCandidates.some((candidate) => text === candidate || text.includes(candidate));
        }) || null;
    }

    function clickMessageBoxConfirm() {
        const boxes = Array.from(document.querySelectorAll('.el-message-box__wrapper, .el-message-box, [role="dialog"]'))
            .filter(isVisible);

        for (const box of boxes) {
            const confirmButton = Array.from(box.querySelectorAll('.el-message-box__btns .el-button--primary, .el-message-box__btns button, button.el-button--primary'))
                .find((button) => {
                    if (!(button.offsetWidth || button.offsetHeight || button.getClientRects().length)) return false;
                    const text = getText(button);
                    return text === '确定' || text.includes('确定') || text === '确认' || text.includes('确认');
                });
            if (confirmButton) {
                const target = confirmButton.closest('button') || confirmButton;
                target.focus();
                target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                return true;
            }
        }

        return false;
    }

    function findSecondaryPageEvaluateButton() {
        return Array.from(document.querySelectorAll('button')).find((button) => {
            if (!isVisible(button)) return false;
            const text = getText(button);
            return (text === CONFIG.evaluateText || text.includes(CONFIG.evaluateText)) && !text.includes(CONFIG.viewText);
        }) || null;
    }

    function clickSecondaryPageEntry() {
        const evaluateButton = findSecondaryPageEvaluateButton();

        if (!evaluateButton || !evaluateButton.__vue__) {
            return false;
        }

        let component = evaluateButton.__vue__;
        for (let depth = 0; depth < 8 && component; depth += 1) {
            if (component.$options && component.$options.methods && typeof component.$options.methods.next === 'function') {
                const rows = Array.isArray(component.$data && component.$data.tableData) ? component.$data.tableData : [];
                if (rows[0]) {
                    component.$options.methods.next.call(component, rows[0]);
                    sessionStorage.setItem(STORAGE_KEYS.entered, '1');
                    return true;
                }
            }
            component = component.$parent;
        }

        evaluateButton.click();
        sessionStorage.setItem(STORAGE_KEYS.entered, '1');
        return true;
    }

    async function repeatSecondaryPageEvaluations() {
        while (findSecondaryPageEvaluateButton()) {
            const entered = clickSecondaryPageEntry();
            if (!entered) {
                break;
            }

            const reachedDetail = await waitFor(() => Boolean(document.querySelector('textarea') || document.body.innerText.includes('请写出你对老师授课的建议')), 12000);
            if (!reachedDetail) {
                throw new Error('已点击进入评价页，但未检测到评价表单。');
            }

            await fillDetailPage();
            await sleep(CONFIG.secondaryRepeatWaitMs);
        }
    }

    function setTextareaValue(text) {
        const textarea = Array.from(document.querySelectorAll('textarea')).find(isVisible);
        if (!textarea) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) {
            setter.call(textarea, text);
        } else {
            textarea.value = text;
        }
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function insertTriggerButton() {
        if (!isTargetPage()) return;
        if (document.getElementById('hnu-auto-eval-trigger')) return;
        const container = document.createElement('div');
        container.id = 'hnu-auto-eval-trigger';
        container.style.cssText = [
            'position: fixed',
            'right: 20px',
            'bottom: 24px',
            'z-index: 999999',
            'padding: 10px 14px',
            'border-radius: 10px',
            'background: #1664ff',
            'color: #fff',
            'font-size: 14px',
            'line-height: 1',
            'cursor: pointer',
            'box-shadow: 0 8px 22px rgba(22, 100, 255, 0.28)',
            'user-select: none',
        ].join(';');
        container.textContent = CONFIG.triggerText;
        container.addEventListener('click', async () => {
            if (running) return;
            running = true;
            sessionStorage.setItem(STORAGE_KEYS.pending, '1');
            container.textContent = '执行中...';
            container.style.opacity = '0.85';
            try {
                await runAutomation();
                container.textContent = '已执行';
            } catch (error) {
                console.error('[HNU Evaluation Auto]', error);
                container.textContent = '执行失败';
                alert(`自动评价失败：${error && error.message ? error.message : error}`);
            } finally {
                sessionStorage.removeItem(STORAGE_KEYS.pending);
                sessionStorage.removeItem(STORAGE_KEYS.entered);
                setTimeout(() => {
                    container.textContent = CONFIG.triggerText;
                    container.style.opacity = '1';
                    running = false;
                }, CONFIG.debounceMs);
            }
        });
        document.body.appendChild(container);
    }

    function isTargetPage() {
        const title = document.title || '';
        const bodyText = document.body ? document.body.innerText || '' : '';
        return location.pathname.includes('/pjxt/evaluate/studentEvaluate/student-jdp/')
            || title.includes(CONFIG.pageTitleKeyword)
            || bodyText.includes(CONFIG.pageTitleKeyword)
            || bodyText.includes('请写出你对老师授课的建议')
            || bodyText.includes('学生期终评价');
    }

    async function waitFor(condition, timeoutMs = 10000, intervalMs = 300) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const result = condition();
            if (result) return result;
            await sleep(intervalMs);
        }
        return null;
    }

    function clickEnterEvaluationPage() {
        const directEntry = findClickableByText('学生期终评价')
            || document.querySelector('a[href*="/pjxt/evaluate/studentEvaluate/student-jdp/index"]');
        if (directEntry) {
            directEntry.click();
            sessionStorage.setItem(STORAGE_KEYS.entered, '1');
            return true;
        }

        if (document.body && document.body.innerText.includes('学生阶段评二级页面')) {
            return clickSecondaryPageEntry();
        }

        const entryRow = findRowByText([CONFIG.evaluateText, CONFIG.editText, `${CONFIG.editText}/${CONFIG.evaluateText}`]);
        const entry = entryRow && Array.from(entryRow.querySelectorAll('button, a, span, div')).find((element) => {
            if (!isVisible(element)) {
                return false;
            }
            const text = getText(element);
            return text.includes(CONFIG.evaluateText)
                || text.includes(CONFIG.editText)
                || text.includes(CONFIG.viewEvaluateText);
        });

        if (!entry) {
            return false;
        }

        const secondaryButton = entry.tagName === 'BUTTON' ? entry : entry.querySelector('button');
        if (secondaryButton) {
            if ((getText(secondaryButton).includes(CONFIG.evaluateText) || getText(secondaryButton).includes(CONFIG.editText)) && !getText(secondaryButton).includes(CONFIG.viewText)) {
                secondaryButton.click();
            } else {
                return false;
            }
        } else {
            if ((getText(entry).includes(CONFIG.evaluateText) || getText(entry).includes(CONFIG.editText)) && !getText(entry).includes(CONFIG.viewText)) {
                entry.click();
            } else {
                return false;
            }
        }
        sessionStorage.setItem(STORAGE_KEYS.entered, '1');
        return true;
    }

    async function fillDetailPage() {
        await sleep(CONFIG.detailWaitMs);

        const rows = Array.from(document.querySelectorAll('tr'));

        for (const row of rows) {
            const rowText = getText(row);
            if (!rowText || rowText.includes('总分') || rowText.includes('主观建议') || rowText.includes('请写出你对老师授课的建议')) {
                continue;
            }

            if (rowText.includes('课程评价（不计分）') || rowText.includes('你愿意向学弟学妹推荐') || rowText.includes('推荐该教师的这门课程')) {
                clickRadioInRow(row, CONFIG.recommendText);
                continue;
            }

            if (rowText.includes(CONFIG.satisfiedText) || rowText.includes('非常满意') || rowText.includes('满意')) {
                clickRadioInRow(row, CONFIG.satisfiedText);
            }
        }

        const textarea = await waitFor(() => Array.from(document.querySelectorAll('textarea')).find(isVisible), 8000);
        if (!textarea) {
            throw new Error('未找到主观建议输入框。');
        }
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) {
            setter.call(textarea, CONFIG.suggestionText);
        } else {
            textarea.value = CONFIG.suggestionText;
        }
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));

        await sleep(CONFIG.subjectiveWaitMs);

        const submitButton = findActionButton([CONFIG.submitText, '提交', '保存'])
            || findClickableByText(CONFIG.submitText)
            || findClickableByText('提交')
            || findClickableByText('保存')
            || document.querySelector('.el-button--primary');
        if (!submitButton) {
            throw new Error('未找到确认按钮。');
        }
        submitButton.click();

        const confirmButton = await waitFor(() => clickMessageBoxConfirm(), 10000, 300);

        if (confirmButton) {
            await sleep(1000);
        }

        await waitFor(() => document.body && (
            document.body.innerText.includes('学生阶段评二级页面')
            || Boolean(findSecondaryPageEvaluateButton())
        ), 15000, 300);
    }

    async function runAutomation() {
        if (!isTargetPage()) {
            throw new Error('请先进入教学评价相关页面后再点击激活按钮。');
        }

        if (document.body && document.body.innerText.includes('学生阶段评二级页面') && !document.querySelector('textarea')) {
            await repeatSecondaryPageEvaluations();
            return;
        }

        if (document.querySelector('textarea') || document.body.innerText.includes('请写出你对老师授课的建议')) {
            await fillDetailPage();
            return;
        }

        if (sessionStorage.getItem(STORAGE_KEYS.entered) !== '1') {
            const entered = clickEnterEvaluationPage();
            if (!entered) {
                throw new Error('未找到“修改/评价”按钮，无法进入评价页。');
            }
        }

        const reachedDetail = await waitFor(() => Boolean(document.querySelector('textarea') || document.body.innerText.includes('请写出你对老师授课的建议')), 12000);
        if (!reachedDetail) {
            throw new Error('已点击进入评价页，但未检测到评价表单。');
        }

        await fillDetailPage();
    }

    function main() {
        insertTriggerButton();
        setInterval(insertTriggerButton, 1000);
        const observer = new MutationObserver(insertTriggerButton);
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main, { once: true });
    } else {
        main();
    }
})();
