/** @odoo-module **/

import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { ImageField } from "@web/views/fields/image/image_field";
import { _t } from "@web/core/l10n/translation";
import { useState, onWillStart, onMounted, useEffect, useRef, xml } from "@odoo/owl";
import { AvatarCardPopover } from "@mail/discuss/web/avatar_card/avatar_card_popover";
import { Popover } from "@web/core/popover/popover";
import { usePopover } from "@web/core/popover/popover_hook";

export class ImagePreviewField extends ImageField {
    static template = "svg_widget.ImagePreviewField";
    static components = { ...ImageField.components, Popover, AvatarCardPopover };

    static props = {
        alt: { type: String, optional: true },
        enableZoom: { type: Boolean, optional: true },
        imgClass: { type: String, optional: true },
        zoomDelay: { type: Number, optional: true },
        previewImage: { type: String, optional: true },
        acceptedFileExtensions: { type: String, optional: true },
        width: { type: Number, optional: true },
        height: { type: Number, optional: true },
        avatar_size: { type: Number, optional: true, },
        reload: { type: Boolean, optional: true },
        convertToWebp: { type: Boolean, optional: true },
        readonly: { type: Boolean, optional: true },
        id: { type: String, optional: true },
        name: { type: String, optional: true },
        record: { type: Object, optional: true },
    };

    setup() {
        super.setup();
        this.popover = useService("popover");
        this.avatarCard = usePopover(AvatarCardPopover);

        this.isReadOnly = this.props.readonly || false;
        this.containerClickHandler = this.containerClickHandler.bind(this);
        this.handleZoom = this.handleZoom.bind(this);
        this.handlePanStart = this.handlePanStart.bind(this);

        this.model = "rs.location";
        this.id = this.extractIdFromUrl();

        this.container = useRef("svgContainer");

        this.state = useState({
            seatAssignments: [],
            modifiedSvgSrc: null,
            zoomLevel: 1,
            panX: 0,
            panY: 0,
            isPanning: false,
            lastPanX: 0,
            lastPanY: 0,
            selectedAvatarIndex: -1,
            isResizing: false,
            resizeHandleType: null,
        });

        this.minZoom = 0.5;
        this.maxZoom = 5;
        this.zoomStep = 0.1;

        this.minAvatarSize = 10;
        this.maxAvatarSize = 100;
        this.handleSize = 8;

        onWillStart(async () => {
            console.log("onWillStart");
            while (!this.props.record || !this.props.record.data) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        });

        onMounted(async () => {
            console.log("onMounted");
            this.renderSvg(this.container);
            if (!this.state.modifiedSvgSrc) {
                let attempts = 0;
                while (!this.container.el && attempts < 10) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }

                if (this.container.el) {
                    await this.fetchSeatAssignmentsAndProcessSvg();
                    this.renderSvg(this.container);
                    this.makeAvatarsDraggable();
                } else {
                    console.error("svgContainer could not be found.");
                }
            }
        });

        useEffect(() => {
            console.log("UseEffect - seat_assignments changed");
            const assignments = Array.isArray(this.props.record.data.seat_assignments)
                ? this.props.record.data.seat_assignments
                : [];
            this.state.seatAssignments = assignments;
            this.fetchSeatAssignmentsAndProcessSvg();
        }, () => [this.props.record.data.seat_assignments]);

        // Watch for SVG field changes and trigger re-render
        useEffect(() => {
            console.log("UseEffect - SVG field changed, triggering re-render");
            if (this.container.el && this.props.name) {
                // Reset component state
                this.resetComponentState();
                // Re-fetch and render
                this.fetchSeatAssignmentsAndProcessSvg();
            }
        }, () => [this.props.record.data[this.props.name], this.props.record.data.write_date]);
    }

    extractIdFromUrl() {
        if (this.props.record && this.props.record.resId) {
            this.id = this.props.record.resId.toString();
        } else {
            const url = new URL(window.location.href);
            const match = url.pathname.match(/(\d+)$/) ||
                url.pathname.match(/\/(\d+)(\/|$)/) ||
                url.search.match(/id=(\d+)/);
            this.id = match ? match[1] : "0";
        }
        return this.id;
    }

    isFormView() {
        const svgContainer = document.getElementsByName("svg_image");
        return svgContainer.length > 0 && svgContainer[0].classList.contains("form-view");
    }

    containerClickHandler(event) {
        const avatarElement = event.target.closest('.draggable-avatar');
        const resizeHandle = event.target.closest('.resize-handle');
        
        if (resizeHandle) {
            return;
        }
        
        if (avatarElement) {
            const index = parseInt(avatarElement.dataset.index);
            
            if (this.isReadOnly) {
            event.preventDefault();
            event.stopPropagation();
            const assignment = this.state.seatAssignments[index];
            this.showUserCard(assignment, avatarElement);
            } else {
                this.selectAvatar(index);
            }
            return;
        }
        
        if (!this.isReadOnly) {
            this.deselectAvatar();
        }
    }
    
    clearContainer(container) {
        if (!container?.el) return false;
        container.el.innerHTML = "";
        return true;
    }

    // Decode base64 SVG data
    decodeSvgData(base64Data) {
        if (!base64Data) return null;
        const decodedSvg = atob(base64Data.replace("data:image/svg+xml;base64,", ""));
        const parser = new DOMParser();
        return parser.parseFromString(decodedSvg, "image/svg+xml").documentElement;
    }

    // Get SVG dimensions, removing units if present
    getSvgDimensions(svgEl) {
        const width = parseFloat((svgEl.getAttribute("width") || 800).toString().replace('mm', ''));
        const height = parseFloat((svgEl.getAttribute("height") || 800).toString().replace('mm', ''));
        return { width, height };
    }

    // Set SVG viewBox and aspect ratio
    configureSvgViewBox(svgEl, width, height) {
        if (!svgEl.getAttribute("viewBox")) {
            svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
        }
        svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
    }

    // Calculate available space for form view
    calculateAvailableSpace(svgContainer) {
        const parent = svgContainer[0].parentElement;
        let otherChildrenHeight = 0;

        for (let child of parent.children) {
            if (child !== svgContainer[0]) {
                const style = window.getComputedStyle(child);
                const height = child.offsetHeight;
                const marginTop = parseFloat(style.marginTop) || 0;
                const marginBottom = parseFloat(style.marginBottom) || 0;
                otherChildrenHeight += height + marginTop + marginBottom;
            }
        }

        const availableHeight = Math.max(window.innerHeight - otherChildrenHeight - 80, 200);
        const availableWidth = Math.max(parent.clientWidth - 40, 300);
        return { availableWidth, availableHeight };
    }

    // Calculate display dimensions based on aspect ratio
    calculateDisplayDimensions(originalWidth, originalHeight, availableWidth, availableHeight) {
        const aspectRatio = originalWidth / originalHeight;
        let displayWidth, displayHeight;

        if (availableWidth / aspectRatio <= availableHeight) {
            displayWidth = Math.min(availableWidth * 0.95, availableWidth);
            displayHeight = displayWidth / aspectRatio;
        } else {
            displayHeight = Math.min(availableHeight * 0.95, availableHeight);
            displayWidth = displayHeight * aspectRatio;
        }

        return { displayWidth, displayHeight };
    }

    // Apply styles for form view
    applyFormViewStyles(svgEl, container, displayWidth, displayHeight) {
        svgEl.setAttribute("width", `${displayWidth}px`);
        svgEl.setAttribute("height", `${displayHeight}px`);
        svgEl.style.display = "block";
        
        const isFormViewZoomable = this.isFormView();
        
        if (isFormViewZoomable) {
            // Zoom-enabled form view styling  
            svgEl.style.margin = "0";
            svgEl.style.maxWidth = "none"; // Allow SVG to grow beyond container when zoomed
            svgEl.style.maxHeight = "none"; // Allow SVG to grow beyond container when zoomed
            svgEl.style.position = "absolute";
            svgEl.style.top = "50%";
            svgEl.style.left = "50%";
            svgEl.style.transform = "translate(-50%, -50%)"; // Center the SVG initially
        } else {
            // Standard kanban/non-zoomable view styling
            svgEl.style.margin = "0 auto";
            svgEl.style.maxWidth = "100%";
            svgEl.style.maxHeight = "100%";
            svgEl.style.position = "static";
            svgEl.style.top = "auto";
            svgEl.style.left = "auto";
            svgEl.style.transform = "none";
        }

        Object.assign(container.el.style, {
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            width: "100%",
            height: "100%",
            overflow: "hidden",
            padding: "10px",
            boxSizing: "border-box",
            position: isFormViewZoomable ? "relative" : "static"
        });
    }

    applyKanbanViewStyles(svgEl, props) {
        const aspectRatio = this.getSvgDimensions(svgEl).width / this.getSvgDimensions(svgEl).height;
        props.width = props.height * aspectRatio;
        svgEl.setAttribute("width", "100%");
        svgEl.setAttribute("height", "100%");
    }

    // Manage click event listeners
    manageClickListeners(container, handler) {
        container.el.removeEventListener("click", handler);
        container.el.addEventListener("click", handler);
        
        // Add zoom and pan event listeners only for form view
        if (this.isFormView()) {
            container.el.removeEventListener("wheel", this.handleZoom);
            container.el.addEventListener("wheel", this.handleZoom, { passive: false });
            
            container.el.removeEventListener("mousedown", this.handlePanStart);
            container.el.addEventListener("mousedown", this.handlePanStart);
            
            // Add double-click to reset zoom
            container.el.removeEventListener("dblclick", this.resetZoomAndPan.bind(this));
            container.el.addEventListener("dblclick", this.resetZoomAndPan.bind(this));
        }
    }

    // Main render function
    renderSvg(container) {
        if (!this.clearContainer(container)) return;

        const svgEl = this.decodeSvgData(this.state.modifiedSvgSrc);
        if (!svgEl) return;

        const { width: originalWidth, height: originalHeight } = this.getSvgDimensions(svgEl);
        this.configureSvgViewBox(svgEl, originalWidth, originalHeight);

        const svgContainer = document.getElementsByName("svg_image");
        const isFormView = svgContainer.length > 0 && svgContainer[0].classList.contains("form-view");

        if (isFormView) {
            const { availableWidth, availableHeight } = this.calculateAvailableSpace(svgContainer);
            const { displayWidth, displayHeight } = this.calculateDisplayDimensions(
                originalWidth,
                originalHeight,
                availableWidth,
                availableHeight
            );
            this.applyFormViewStyles(svgEl, container, displayWidth, displayHeight);
        } else {
            this.applyKanbanViewStyles(svgEl, this.props);
        }

        this.manageClickListeners(container, this.containerClickHandler);
        container.el.appendChild(svgEl);
        
        if (this.isFormView()) {
            this.applyZoomAndPan();
        }
        
        if (this.state.selectedAvatarIndex !== -1 && !this.isReadOnly) {
            setTimeout(() => this.renderResizeHandles(), 10);
        }
    }

    makeAvatarsDraggable() {
        const container = this.container.el;
        if (!container) return;
        if (this.isReadOnly) return;

        const avatars = container.querySelectorAll(".draggable-avatar");
        avatars.forEach((imageElement) => {
            imageElement.addEventListener("mousedown", (event) => {
                const index = imageElement.dataset.index;
                const assignment = this.state.seatAssignments[index];
                this.startDrag(event, assignment, imageElement);
            });
        });
    }

    async fetchSeatAssignmentsAndProcessSvg() {
        if (this.model === "rs.location" && this.id && this.id !== "0") {
            let attempts = 0;
            const maxAttempts = 3;

            while (attempts < maxAttempts) {
                try {
                    // Fetch seat assignments and process SVG
                    const seatAssignments = await this.orm.searchRead(
                        "rs.location.seat.assignment",
                        [["location_id", "=", parseInt(this.id)]],
                        ["user_id", "position_x", "position_y", "avatar_size"],
                        { limit: 0 }
                    );

                    const userIds = seatAssignments.map(assignment => assignment.user_id[0]);
                    const users = await this.orm.searchRead(
                        "res.users",
                        [["id", "in", userIds]],
                        ["image_128", "name", "email", "login", "create_date", "write_date"],
                        { limit: 0 }
                    );

                    this.state.seatAssignments = seatAssignments.map(assignment => {
                        const user = users.find(u => u.id === assignment.user_id[0]);
                        return {
                            ...assignment,
                            avatar: user && user.image_128 ? `data:image/png;base64,${user.image_128}` : "/web/static/img/user_avatar.png",
                            user_details: user || {}
                        };
                    });

                    let svgSrc;

                    if (this.props.name) {
                        // Add timestamp to prevent caching issues when SVG changes
                        const timestamp = new Date().getTime();
                        svgSrc = `/web/image/${this.model}/${this.id}/${this.props.name}?format=svg&t=${timestamp}`;
                    } else {
                        console.error("this.props.name is undefined. Unable to construct SVG URL.");
                        return;
                    }

                    let svgContent;
                    if (svgSrc.startsWith("data:image/svg+xml;base64,")) {
                        const base64String = svgSrc.replace("data:image/svg+xml;base64,", "");
                        svgContent = atob(base64String);
                    } else {
                        const response = await fetch(svgSrc, {
                            headers: { 'Accept': 'image/svg+xml' },
                        });
                        if (!response.ok) {
                            throw new Error(`Failed to fetch SVG: ${response.status} ${response.statusText}`);
                        }
                        svgContent = await response.text();
                    }

                    if (!svgContent.includes('<svg')) {
                        svgContent = `<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="300" height="300" fill="white"/></svg>`;
                    }

                    const modifiedSvg = this.addAvatarsToSvg(svgContent, this.state.seatAssignments);
                    this.state.modifiedSvgSrc = `data:image/svg+xml;base64,${btoa(modifiedSvg)}`;
                    
                    // Always re-render when we get new SVG content
                    if (this.container.el) {
                        this.renderSvg(this.container);
                        this.makeAvatarsDraggable();
                    }

                    // Exit retry loop on success
                    return;
                } catch (error) {
                    console.error(`Error in fetchSeatAssignmentsAndProcessSvg (attempt ${attempts + 1}):`, error);
                    attempts++;
                    if (attempts >= maxAttempts) {
                        console.error("Max attempts reached. Using fallback SVG.");
                        this.state.modifiedSvgSrc = `data:image/svg+xml;base64,${btoa('<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="300" height="300" fill="white"/></svg>')}`;
                        
                        // Re-render with fallback SVG
                        if (this.container.el) {
                            this.renderSvg(this.container);
                        }
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 500)); // Wait before retrying
                    }
                }
            }
        }
    }

    addAvatarsToSvg(svgContent, seatAssignments) {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgContent, "image/svg+xml");
        const svgElement = svgDoc.documentElement;

        // Get original SVG dimensions
        const originalWidth = parseFloat((svgElement.getAttribute("width") || 800).toString().replace('mm', ''));
        const originalHeight = parseFloat((svgElement.getAttribute("height") || 800).toString().replace('mm', ''));
        
        // Normalize avatar size to be consistent across different SVG sizes
        const baseSize = this.props.avatar_size || 20;
        
        // Define a reference size for consistent avatar scaling
        const REFERENCE_SIZE = 1000;
        const scaleFactor = REFERENCE_SIZE / Math.max(originalWidth, originalHeight);
        
        // Calculate normalized avatar size based on the scaling factor
        // This ensures avatars appear the same size regardless of SVG dimensions
        const normalizedAvatarSize = baseSize / scaleFactor;

        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("id", "seat-avatars");

        seatAssignments.forEach((assignment, index) => {
            const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
            
            // Use stored avatar size or default normalized size
            const avatarSize = assignment.avatar_size || normalizedAvatarSize;
            const avatarOffset = avatarSize / 2;
            
            image.setAttribute("x", assignment.position_x - avatarOffset);
            image.setAttribute("y", assignment.position_y - avatarOffset);
            image.setAttribute("width", avatarSize);
            image.setAttribute("height", avatarSize);
            image.setAttribute("href", assignment.avatar);
            image.setAttribute("class", "draggable-avatar");

            if (this.isReadOnly) {
                image.setAttribute(
                    "style",
                    "pointer-events: all; filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.4)); cursor: pointer;"
                );
            } else {
                image.setAttribute(
                    "style",
                    "pointer-events: all; filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.4)); cursor: grabbing;"
                );
            }

            image.dataset.index = index;

            if (!this.isReadOnly) {
                image.addEventListener("mousedown", (event) => {
                    this.startDrag(event, assignment, image);
                });
            }

            group.appendChild(image);
        });

        svgElement.appendChild(group);
        const serializer = new XMLSerializer();
        const modifiedSvg = serializer.serializeToString(svgDoc);
        return modifiedSvg;
    }

    showUserCard(assignment, target) {
        this.avatarCard.open(target, {
            id: assignment.user_id[0],
        });
    }

    startDrag(event, assignment, imageElement) {
        event.preventDefault();
        event.stopPropagation();

        const svg = imageElement.ownerSVGElement;
        
        // Get initial mouse position in SVG coordinates
        const startCoords = this.screenToSvgCoordinates(event.clientX, event.clientY);
        
        // Get current avatar center position
        const avatarSize = parseFloat(imageElement.getAttribute("width"));
        const currentCenterX = parseFloat(imageElement.getAttribute("x")) + avatarSize / 2;
        const currentCenterY = parseFloat(imageElement.getAttribute("y")) + avatarSize / 2;
        
        // Calculate offset from mouse to avatar center at start
        const offsetX = startCoords.x - currentCenterX;
        const offsetY = startCoords.y - currentCenterY;

        const onMouseMove = (moveEvent) => {
            // Get current mouse position in SVG coordinates
            const currentCoords = this.screenToSvgCoordinates(moveEvent.clientX, moveEvent.clientY);
            
            // Calculate new avatar center position (mouse position minus offset)
            const newCenterX = currentCoords.x - offsetX;
            const newCenterY = currentCoords.y - offsetY;
            
            // Convert to top-left position for the image element
            const newX = newCenterX - avatarSize / 2;
            const newY = newCenterY - avatarSize / 2;

            // Update avatar position
            imageElement.setAttribute("x", newX);
            imageElement.setAttribute("y", newY);
            
            // Update assignment position in real-time for resize handles
            assignment.position_x = newCenterX;
            assignment.position_y = newCenterY;
            
            // Update resize handles if this avatar is selected
            const avatarIndex = parseInt(imageElement.dataset.index);
            if (this.state.selectedAvatarIndex === avatarIndex) {
                this.renderResizeHandles();
            }
        };

        const onMouseUp = async () => {
            // Update the position in the state
            // Calculate center position from current avatar position
            const avatarSize = parseFloat(imageElement.getAttribute("width"));
            const avatarOffset = avatarSize / 2;
            
            const newX = parseFloat(imageElement.getAttribute("x")) + avatarOffset;
            const newY = parseFloat(imageElement.getAttribute("y")) + avatarOffset;
            assignment.position_x = newX;
            assignment.position_y = newY;

            // Save the updated position to the backend
            await this.orm.write("rs.location.seat.assignment", [assignment.id], {
                position_x: newX,
                position_y: newY,
            });

            await this.props.record.load();

            // Remove event listeners
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }

    // Start resize operation
    startResize(event, avatarIndex, handleType) {
        if (this.isReadOnly) return;
        
        event.preventDefault();
        event.stopPropagation();

        this.state.isResizing = true;
        this.state.resizeHandleType = handleType;

        const assignment = this.state.seatAssignments[avatarIndex];
        const avatarElement = this.container.el.querySelector(`[data-index="${avatarIndex}"]`);
        
        if (!assignment || !avatarElement) return;

        const initialSize = parseFloat(assignment.avatar_size || this.props.avatar_size || 20);
        const startCoords = this.screenToSvgCoordinates(event.clientX, event.clientY);
        
        // Store initial mouse coordinates for relative resize calculation
        const startScreenX = event.clientX;
        const startScreenY = event.clientY;

        const onMouseMove = (moveEvent) => {
            if (!this.state.isResizing) return;

            // Calculate mouse movement in screen pixels
            const deltaScreenX = moveEvent.clientX - startScreenX;
            const deltaScreenY = moveEvent.clientY - startScreenY;
            
            // Use diagonal distance for resize calculation
            const deltaDistance = Math.sqrt(deltaScreenX * deltaScreenX + deltaScreenY * deltaScreenY);
            
            // Determine resize direction (positive = grow, negative = shrink)
            const resizeDirection = (deltaScreenX + deltaScreenY) >= 0 ? 1 : -1;
            
            // Calculate new size based on mouse movement
            // Scale factor adjusts sensitivity (smaller = more sensitive)
            const scaleFactor = 0.5;
            let newSize = initialSize + (deltaDistance * resizeDirection * scaleFactor);
            
            // Apply size constraints
            newSize = Math.max(this.minAvatarSize, Math.min(this.maxAvatarSize, newSize));
            
            // Update avatar size visually
            this.updateAvatarSize(avatarIndex, newSize);
            this.renderResizeHandles(); // Update handles position
        };

        const onMouseUp = async () => {
            if (!this.state.isResizing) return;
            
            this.state.isResizing = false;
            this.state.resizeHandleType = null;

            // Save the new size to database
            const newSize = parseFloat(avatarElement.getAttribute("width"));
            assignment.avatar_size = newSize;

            await this.orm.write("rs.location.seat.assignment", [assignment.id], {
                avatar_size: newSize,
            });

            await this.props.record.load();

            // Remove event listeners
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }

    // Update avatar size visually
    updateAvatarSize(avatarIndex, newSize) {
        const avatarElement = this.container.el.querySelector(`[data-index="${avatarIndex}"]`);
        if (!avatarElement) return;

        const assignment = this.state.seatAssignments[avatarIndex];
        if (!assignment) return;

        // Update avatar element
        const offset = newSize / 2;
        avatarElement.setAttribute("x", assignment.position_x - offset);
        avatarElement.setAttribute("y", assignment.position_y - offset);
        avatarElement.setAttribute("width", newSize);
        avatarElement.setAttribute("height", newSize);

        // Update assignment object
        assignment.avatar_size = newSize;
    }

    // Handle zoom functionality (only in form view)
    handleZoom(event) {
        if (!this.container.el || !this.isFormView()) return;
        
        event.preventDefault();
        event.stopPropagation();

        const rect = this.container.el.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        const delta = event.deltaY > 0 ? -this.zoomStep : this.zoomStep;
        const newZoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, this.state.zoomLevel + delta));

        if (newZoomLevel !== this.state.zoomLevel) {
            // Calculate zoom origin point
            const zoomFactor = newZoomLevel / this.state.zoomLevel;
            
            // Adjust pan to zoom toward mouse cursor
            this.state.panX = mouseX - zoomFactor * (mouseX - this.state.panX);
            this.state.panY = mouseY - zoomFactor * (mouseY - this.state.panY);
            this.state.zoomLevel = newZoomLevel;

            this.applyZoomAndPan();
        }
    }

    // Handle pan start (only in form view)
    handlePanStart(event) {
        if (!this.isFormView()) return; // Pan always available in form view

        // Prevent panning when clicking on draggable avatars or resize handles in edit mode
        if (!this.isReadOnly && (
            event.target.classList.contains('draggable-avatar') ||
            event.target.classList.contains('resize-handle') ||
            this.state.isResizing
        )) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        this.state.isPanning = true;
        this.state.lastPanX = event.clientX;
        this.state.lastPanY = event.clientY;

        const handlePanMove = (moveEvent) => {
            if (!this.state.isPanning) return;

            const deltaX = moveEvent.clientX - this.state.lastPanX;
            const deltaY = moveEvent.clientY - this.state.lastPanY;

            this.state.panX += deltaX;
            this.state.panY += deltaY;
            this.state.lastPanX = moveEvent.clientX;
            this.state.lastPanY = moveEvent.clientY;

            this.applyZoomAndPan();
        };

        const handlePanEnd = () => {
            this.state.isPanning = false;
            document.removeEventListener('mousemove', handlePanMove);
            document.removeEventListener('mouseup', handlePanEnd);
            
            // Reset cursor (always grab in form view)
            if (this.container.el) {
                this.container.el.style.cursor = 'grab';
            }
        };

        document.addEventListener('mousemove', handlePanMove);
        document.addEventListener('mouseup', handlePanEnd);
        
        // Change cursor during pan
        if (this.container.el) {
            this.container.el.style.cursor = 'grabbing';
        }
    }

    // Apply zoom and pan transformation to SVG (only in form view)
    applyZoomAndPan() {
        if (!this.container.el || !this.isFormView()) return;

        const svg = this.container.el.querySelector('svg');
        if (!svg) return;

        // Combine centering, panning and scaling transformations
        const centerTransform = "translate(-50%, -50%)";
        const panTransform = `translate(${this.state.panX}px, ${this.state.panY}px)`;
        const scaleTransform = `scale(${this.state.zoomLevel})`;
        
        // Apply combined transformation (order matters: center, then scale, then pan)
        const combinedTransform = `${centerTransform} ${scaleTransform} ${panTransform}`;
        svg.style.transform = combinedTransform;
        svg.style.transformOrigin = 'center center';
        svg.style.transition = 'transform 0.1s ease-out';

        // Adjust container to accommodate zoomed content
        this.adjustContainerForZoom(svg);

        // Update cursor for pan capability (always show grab cursor in form view)
        if (this.container.el) {
            this.container.el.style.cursor = 'grab';
        }
    }

    // Adjust container size and positioning for zoom level (only called from form view)
    adjustContainerForZoom(svg) {
        if (!this.container.el || !svg) return;

        const svgContainer = document.getElementsByName("svg_image");
        
        // For form view, ensure the container can accommodate the zoomed SVG
        const originalWidth = parseFloat(svg.getAttribute("width"));
        const originalHeight = parseFloat(svg.getAttribute("height"));
        
        if (originalWidth && originalHeight) {
            // Calculate the space needed for the zoomed SVG
            const zoomedWidth = originalWidth * this.state.zoomLevel;
            const zoomedHeight = originalHeight * this.state.zoomLevel;
            
            // Get the parent container
            const parent = this.container.el.parentElement;
            if (parent) {
                // Calculate available space
                const { availableWidth, availableHeight } = this.calculateAvailableSpace(svgContainer);
                
                // Ensure container can show the zoomed content properly
                const containerWidth = Math.max(availableWidth, Math.min(zoomedWidth + 20, availableWidth * 2));
                const containerHeight = Math.max(availableHeight, Math.min(zoomedHeight + 20, availableHeight * 2));
                
                // Update container dimensions
                this.container.el.style.width = `${containerWidth}px`;
                this.container.el.style.height = `${containerHeight}px`;
                this.container.el.style.minWidth = `${availableWidth}px`;
                this.container.el.style.minHeight = `${availableHeight}px`;
            }
        }
    }

    // Reset zoom and pan to default (only in form view)
    resetZoomAndPan() {
        if (!this.isFormView()) return;
        
        this.state.zoomLevel = 1;
        this.state.panX = 0;
        this.state.panY = 0;
        
        // Reset container size
        if (this.container.el) {
            this.container.el.style.width = "100%";
            this.container.el.style.height = "100%";
            this.container.el.style.minWidth = "";
            this.container.el.style.minHeight = "";
        }
        
        this.applyZoomAndPan();
    }

    // Convert screen coordinates to SVG coordinates accounting for zoom and pan
    screenToSvgCoordinates(screenX, screenY) {
        if (!this.container.el) return { x: 0, y: 0 };
        
        const svg = this.container.el.querySelector('svg');
        if (!svg) return { x: 0, y: 0 };

        // Use SVG's built-in coordinate transformation
        const pt = svg.createSVGPoint();
        pt.x = screenX;
        pt.y = screenY;

        try {
            // Get the screen CTM (Current Transformation Matrix)
            const screenCTM = svg.getScreenCTM();
            if (screenCTM) {
                // Transform screen coordinates to SVG coordinates
                const svgPoint = pt.matrixTransform(screenCTM.inverse());
                return { x: svgPoint.x, y: svgPoint.y };
            }
        } catch (error) {
            console.warn("Failed to get screen CTM, using fallback method:", error);
        }

        // Fallback method
        const rect = this.container.el.getBoundingClientRect();
        let x = screenX - rect.left;
        let y = screenY - rect.top;
        
        return { x, y };
    }

    // Select avatar for editing
    selectAvatar(index) {
        this.state.selectedAvatarIndex = index;
        this.renderResizeHandles();
    }

    // Deselect avatar
    deselectAvatar() {
        this.state.selectedAvatarIndex = -1;
        this.removeResizeHandles();
    }

    // Render resize handles around selected avatar
    renderResizeHandles() {
        if (!this.container.el || this.state.selectedAvatarIndex === -1) return;
        
        const svg = this.container.el.querySelector('svg');
        if (!svg) return;

        // Remove existing handles
        this.removeResizeHandles();

        const assignment = this.state.seatAssignments[this.state.selectedAvatarIndex];
        if (!assignment) return;

        // Get current avatar size from the DOM element or assignment
        const avatarElement = this.container.el.querySelector(`[data-index="${this.state.selectedAvatarIndex}"]`);
        const avatarSize = avatarElement ? 
            parseFloat(avatarElement.getAttribute("width")) : 
            parseFloat(assignment.avatar_size || this.props.avatar_size || 20);
        
        const avatarX = assignment.position_x - avatarSize / 2;
        const avatarY = assignment.position_y - avatarSize / 2;

        // Create resize handles group
        const handlesGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        handlesGroup.setAttribute("id", "resize-handles");

        // Selection border
        const selectionRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        selectionRect.setAttribute("x", avatarX - 2);
        selectionRect.setAttribute("y", avatarY - 2);
        selectionRect.setAttribute("width", avatarSize + 4);
        selectionRect.setAttribute("height", avatarSize + 4);
        selectionRect.setAttribute("fill", "none");
        selectionRect.setAttribute("stroke", "#007cff");
        selectionRect.setAttribute("stroke-width", "2");
        selectionRect.setAttribute("stroke-dasharray", "5,5");
        handlesGroup.appendChild(selectionRect);

        // Resize handle (bottom-right corner)
        const handle = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        handle.setAttribute("x", avatarX + avatarSize - this.handleSize / 2);
        handle.setAttribute("y", avatarY + avatarSize - this.handleSize / 2);
        handle.setAttribute("width", this.handleSize);
        handle.setAttribute("height", this.handleSize);
        handle.setAttribute("fill", "#007cff");
        handle.setAttribute("stroke", "#ffffff");
        handle.setAttribute("stroke-width", "1");
        handle.setAttribute("class", "resize-handle");
        handle.setAttribute("data-handle-type", "se");
        handle.style.cursor = "se-resize";
        handle.style.pointerEvents = "all";

        // Add resize event listener
        handle.addEventListener("mousedown", (event) => {
            this.startResize(event, this.state.selectedAvatarIndex, "se");
        });

        handlesGroup.appendChild(handle);
        svg.appendChild(handlesGroup);
    }

    // Remove resize handles
    removeResizeHandles() {
        if (!this.container.el) return;
        
        const svg = this.container.el.querySelector('svg');
        if (!svg) return;

        const handlesGroup = svg.querySelector("#resize-handles");
        if (handlesGroup) {
            handlesGroup.remove();
        }
    }

    // Reset component state when SVG changes
    resetComponentState() {
        console.log("Resetting component state");
        this.state.modifiedSvgSrc = null;
        this.state.zoomLevel = 1;
        this.state.panX = 0;
        this.state.panY = 0;
        this.state.isPanning = false;
        this.state.selectedAvatarIndex = -1;
        this.state.isResizing = false;
        this.state.resizeHandleType = null;
        
        // Clear the container
        if (this.container.el) {
            this.clearContainer(this.container);
            this.removeResizeHandles();
        }
    }

    // Force refresh the entire component (useful for external calls)
    forceRefresh() {
        console.log("Force refreshing SVG component");
        if (this.container.el) {
            this.resetComponentState();
            this.fetchSeatAssignmentsAndProcessSvg();
        }
    }
}

export const imageView = {
    component: ImagePreviewField,
    displayName: _t("ImagePreview"),
    supportedAttributes: [
        {
            label: _t("Alternative text"),
            name: "alt",
            type: "string",
        },
    ],
    supportedOptions: [
        {
            label: _t("Reload"),
            name: "reload",
            type: "boolean",
            default: true,
        },
        {
            label: _t("Enable zoom"),
            name: "zoom",
            type: "boolean",
        },
        {
            label: _t("Convert to webp"),
            name: "convert_to_webp",
            type: "boolean",
        },
        {
            label: _t("Zoom delay"),
            name: "zoom_delay",
            type: "number",
            help: _t("Delay the apparition of the zoomed image with a value in milliseconds"),
        },
        {
            label: _t("Accepted file extensions"),
            name: "accepted_file_extensions",
            type: "string",
        },
        {
            label: _t("Size"),
            name: "size",
            type: "selection",
            choices: [
                { label: _t("Small"), value: "[0,90]" },
                { label: _t("Medium"), value: "[0,180]" },
                { label: _t("Large"), value: "[0,270]" },
            ],
        },
        {
            label: _t("Preview image"),
            name: "preview_image",
            type: "field",
            availableTypes: ["binary"],
        },
    ],
    supportedTypes: ["binary", "many2one"],
    fieldDependencies: [
        { name: "write_date", type: "datetime" },
        { name: "seat_assignments", type: "one2many" }
    ],
    isEmpty: () => false,
    extractProps: ({ attrs, options }) => ({
        alt: attrs.alt,
        enableZoom: options.zoom,
        convertToWebp: options.convert_to_webp,
        imgClass: options.img_class,
        zoomDelay: options.zoom_delay,
        previewImage: options.preview_image,
        acceptedFileExtensions: options.accepted_file_extensions,
        width: options.size && Boolean(options.size[0]) ? options.size[0] : attrs.width,
        height: options.size && Boolean(options.size[1]) ? options.size[1] : attrs.height,
        avatar_size: options.avatar_size,
        reload: "reload" in options ? Boolean(options.reload) : true,
    }),
};

registry.category("fields").add("svg_view", imageView);