let nextGroup = 0;

export function mountProjectTabs(navigation: HTMLElement, panels: HTMLElement[], labels: string[], changed: () => void): (index: number) => void {
	const group = ++nextGroup;
	const buttons: HTMLButtonElement[] = [];
	navigation.setAttribute("role", "tablist");
	if (!navigation.hasAttribute("aria-label")) navigation.setAttribute("aria-label", "Configuration du projet");
	const select = (index: number) => {
		for (const [position, panel] of panels.entries()) {
			panel.hidden = position !== index;
			buttons[position].setAttribute("aria-selected", String(position === index));
			buttons[position].tabIndex = position === index ? 0 : -1;
		}
	};
	for (const [index, label] of labels.entries()) {
		const button = navigation.ownerDocument.createElement("button"); button.type = "button"; button.textContent = label;
		button.id = "bookbinder-tab-" + group + "-" + index;
		button.setAttribute("role", "tab");
		panels[index].id = "bookbinder-panel-" + group + "-" + index;
		panels[index].classList.add("bookbinder-project-panel");
		panels[index].setAttribute("role", "tabpanel");
		panels[index].setAttribute("aria-labelledby", button.id);
		button.setAttribute("aria-controls", panels[index].id);
		button.addEventListener("click", () => { select(index); changed(); });
		button.addEventListener("keydown", event => {
			const target = event.key === "ArrowRight" ? (index + 1) % labels.length : event.key === "ArrowLeft" ? (index + labels.length - 1) % labels.length : event.key === "Home" ? 0 : event.key === "End" ? labels.length - 1 : undefined;
			if (target !== undefined) { event.preventDefault(); select(target); changed(); buttons[target].focus(); }
		});
		buttons.push(button); navigation.append(button);
	}
	select(0);
	return select;
}
