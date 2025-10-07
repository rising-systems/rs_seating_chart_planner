/** @odoo-module **/

import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { ImageField } from "@web/views/fields/image/image_field";
import { _t } from "@web/core/l10n/translation";
import { useState, onWillStart, onMounted, useEffect, useRef, xml } from "@odoo/owl";
import { AvatarCardPopover } from "@mail/discuss/web/avatar_card/avatar_card_popover";
import { Popover } from "@web/core/popover/popover";

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

        this.isReadOnly = this.props.readonly || false;
        this.containerClickHandler = this.containerClickHandler.bind(this);

        this.model = this.extractModelFromSessionStorage();
        this.id = this.extractIdFromUrl();

        this.container = useRef("svgContainer");

        this.state = useState({
            seatAssignments: [],
            modifiedSvgSrc: null,
            selectedAvatarIndex: -1,
            isResizing: false,
            resizeHandleType: null,
            isLoading: true,
            svgReady: false,
            isDragging: false,
        });

        this.minAvatarSize = 10;
        this.maxAvatarSize = 100;
        this.handleSize = 8;

        onWillStart(async () => {
            // Wait for props.record to be available
            while (!this.props.record || !this.props.record.data) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        });

        onMounted(async () => {
            // Wait for container to be available
            let attempts = 0;
            while (!this.container.el && attempts < 10) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }

            if (!this.container.el) {
                console.error("svgContainer could not be found.");
                this.state.isLoading = false;
                return;
            }

            // Load SVG data first, then render
            try {
                await this.fetchSeatAssignmentsAndProcessSvg();
                this.state.svgReady = true;
                this.renderSvg(this.container);
                this.makeAvatarsDraggable();
            } catch (error) {
                console.error(" Error during SVG initialization:", error);
            } finally {
                this.state.isLoading = false;

                // Critical fix: If we have SVG content after loading, render it immediately
                if (this.state.modifiedSvgSrc && this.container.el) {
                    this.renderSvg(this.container);
                }
            }
        });

        // Use useEffect to watch for changes in seat_assignments
        useEffect(() => {
            const assignments = Array.isArray(this.props.record.data.seat_assignments)
                ? this.props.record.data.seat_assignments
                : [];
            this.state.seatAssignments = assignments;

            // Only re-fetch and render if component is already initialized
            if (this.state.svgReady) {
                this.fetchSeatAssignmentsAndProcessSvg();
            }
        }, () => [this.props.record.data.seat_assignments]);
    }

    extractModelFromSessionStorage() {
        const currentAction = sessionStorage.getItem("current_action");
        const parsedAction = currentAction ? JSON.parse(currentAction) : {};
        this.model = parsedAction.res_model || "rs.location";
        return this.model;
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

    renderSvg(container) {
        if (!container || !container.el) {
            return;
        }

        // Show loading state if SVG is not ready
        if (this.state.isLoading || !this.state.modifiedSvgSrc) {
            container.el.innerHTML = '<div style="display: flex; justify-content: center; align-items: center; height: 200px; color: #666;"><i class="fa fa-spinner fa-spin"></i> Loading SVG...</div>';
            return;
        }

        let svg_image_container = document.getElementsByName("svg_image");
        if (svg_image_container.length > 0) {
            // Check if the first element has the "user-form" class
            if (svg_image_container[0].classList.contains("user-form")) {
                svg_image_container[0].style.width = (window.innerWidth - 50) + "px";
            }
        }

        container.el.innerHTML = ""; // Clear previous content

        const b64data = this.state.modifiedSvgSrc?.replace("data:image/svg+xml;base64,", "");

        if (!b64data) {
            container.el.innerHTML = '<div style="display: flex; justify-content: center; align-items: center; height: 200px; color: #999;">No SVG data available</div>';
            return;
        }

        const parser = new DOMParser();
        const decodedSvg = atob(b64data);
        const doc = parser.parseFromString(decodedSvg, "image/svg+xml");

        const svgEl = doc.documentElement;
        // Get width and height, removing 'mm' units if present
        const width = parseFloat((svgEl.getAttribute("width") || 800).toString().replace('mm', ''));
        const height = parseFloat((svgEl.getAttribute("height") || 800).toString().replace('mm', ''));

        // calculate the scaling ratio
        const scaling_ratio = width / height;
        this.props.width = this.props.height * scaling_ratio;

        svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
        svgEl.setAttribute("width", "100%");
        svgEl.setAttribute("height", "100%");

        // Remove any existing click handler
        container.el.removeEventListener("click", this.containerClickHandler);

        // Add the click handler to the container
        container.el.addEventListener("click", this.containerClickHandler);

        container.el.appendChild(svgEl);

        // Force browser reflow and repaint to ensure SVG visibility
        // This fixes the issue where SVG is in DOM but not visible until tab change
        container.el.offsetHeight; // Force reflow
        container.el.style.transform = 'translateZ(0)'; // Force repaint

        // Use requestAnimationFrame for proper timing
        requestAnimationFrame(() => {
            container.el.style.transform = ''; // Clear the transform
            // Double RAF to ensure rendering is complete
            requestAnimationFrame(() => {
                // Make avatars draggable after rendering is complete
                this.makeAvatarsDraggable();
            });
        });

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
            // Remove any existing event listeners to prevent duplicates
            imageElement.removeEventListener("mousedown", this.handleMouseDown);

            // Create a bound handler for this element
            const handleMouseDown = (event) => {
                const index = imageElement.dataset.index;
                const assignment = this.state.seatAssignments[index];
                this.startDrag(event, assignment, imageElement);
            };

            // Store the handler for later removal
            imageElement._mouseDownHandler = handleMouseDown;

            // Add the event listener
            imageElement.addEventListener("mousedown", handleMouseDown);
        });
    }

    /**
     * Detect MIME type from base64 data
     * @param {string} base64 - base64 encoded data
     * @returns {string} - detected MIME type
     */
    detectMimeTypeFromBase64(base64) {
        if (!base64) return 'image/png';

        // Remove any existing data URL prefix if present
        const cleanBase64 = base64.replace(/^data:[^;]*;base64,/, '');

        try {
            // Decode first few bytes to check file signature
            const binaryString = atob(cleanBase64.substring(0, 50));
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Check file signatures (magic numbers)
            if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
                return 'image/jpeg';
            }
            if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
                return 'image/png';
            }
            if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
                return 'image/gif';
            }
            if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
                return 'image/webp';
            }

            // Check for SVG (look for '<svg' or '<?xml')
            const textStart = binaryString.substring(0, 20).toLowerCase();
            if (textStart.includes('<svg') || textStart.includes('<?xml')) {
                return 'image/svg+xml';
            }

            // Default fallback
            return 'image/png';
        } catch (error) {
            console.warn('Could not detect MIME type, defaulting to PNG:', error);
            return 'image/png';
        }
    }

    async fetchSeatAssignmentsAndProcessSvg() {
        // First, try to load the base SVG regardless of model type
        await this.loadBaseSvg();

        // Then, if it's a location model, add seat assignments
        if (this.model === "rs.location") {
            // Handle new records (ID "0") - just show the base SVG without seat assignments
            if (this.id === "0") {
                if (this.baseSvgContent && this.baseSvgContent.includes('<svg')) {
                    this.state.modifiedSvgSrc = `data:image/svg+xml;base64,${btoa(this.baseSvgContent)}`;

                    // For new records, we're done processing - set loading to false and render immediately
                    this.state.isLoading = false;

                    if (this.container.el) {
                        this.renderSvg(this.container);
                    }
                } else {
                }
                return; // Skip seat assignment processing for new records
            }

            // Process existing records with seat assignments
            if (this.id && this.id !== "0") {
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

                        let avatar = "/web/static/img/user_placeholder.jpg";
                        if (user && user.image_128) {
                            const mimeType = this.detectMimeTypeFromBase64(user.image_128);
                            avatar = `data:${mimeType};base64,${user.image_128}`;
                        }

                        return {
                            ...assignment,
                            avatar: avatar,
                            user_details: user || {}
                        };
                    });

                    // Use the base SVG content that was already loaded
                    let svgContent = this.baseSvgContent;

                    if (!svgContent || !svgContent.includes('<svg')) {
                        console.error("Base SVG content not available, using fallback");
                        svgContent = `<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="300" height="300" fill="white"/></svg>`;
                    }

                    const modifiedSvg = this.addAvatarsToSvg(svgContent, this.state.seatAssignments);
                    this.state.modifiedSvgSrc = `data:image/svg+xml;base64,${btoa(modifiedSvg)}`;

                    // Only render if component is mounted and ready
                    if (this.container.el && this.state.svgReady) {
                        this.renderSvg(this.container);
                        this.makeAvatarsDraggable();
                    } else {
                    }

                    // Exit retry loop on success
                    return;
                } catch (error) {
                    console.error(`Error in fetchSeatAssignmentsAndProcessSvg (attempt ${attempts + 1}):`, error);
                    attempts++;
                    if (attempts >= maxAttempts) {
                        console.error("Max attempts reached. Using fallback SVG.");
                        this.state.modifiedSvgSrc = `data:image/svg+xml;base64,${btoa('<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="300" height="300" fill="white"/></svg>')}`;
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 500)); // Wait before retrying
                    }
                }
            }
            } // Close the "if (this.id && this.id !== "0")" block
        } else {
            // For non-location models or when seat assignments aren't needed,
            // just ensure the base SVG was loaded - rendering will happen in onMounted
        }
    }

    async loadBaseSvg() {
        try {
            let svgContent;

            // Check if we have the SVG field name
            if (!this.props.name) {
                console.error(" this.props.name is undefined. Unable to construct SVG URL.");
                // Use fallback SVG
                this.state.modifiedSvgSrc = `data:image/svg+xml;base64,${btoa('<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="300" height="300" fill="lightgray"/><text x="150" y="150" text-anchor="middle" fill="black">No SVG Available</text></svg>')}`;
                return;
            }

            // For new records (ID=0), get the data directly from the form field
            if (this.id === "0") {
                const fieldValue = this.props.record.data[this.props.name];
                if (fieldValue) {
                    try {
                        // The field value should be base64 encoded
                        const decodedContent = atob(fieldValue);
                        if (decodedContent.includes('<svg') || decodedContent.includes('<?xml')) {
                            svgContent = decodedContent;
                        } else {
                        }
                    } catch (decodeError) {
                    }
                } else {
                }
            }

            // If we didn't get SVG content from form field (or for existing records), try server fetch
            if (!svgContent && this.id !== "0") {
                // Try multiple approaches to get the original SVG file
                // First, try to get the raw binary data through the ORM
                try {
                    const recordData = await this.orm.read(this.model, [parseInt(this.id)], [this.props.name]);
                    if (recordData && recordData.length > 0 && recordData[0][this.props.name]) {
                        const rawData = recordData[0][this.props.name];

                        // Try to decode as base64
                        try {
                            const decodedContent = atob(rawData);
                            if (decodedContent.includes('<svg') || decodedContent.includes('<?xml')) {
                                svgContent = decodedContent;
                            }
                        } catch (decodeError) {
                        }
                    }
                } catch (ormError) {
                }

                // If ORM approach failed, try the standard URL approach
                if (!svgContent) {
                    // Try different URL formats
                    const urlsToTry = [
                        `/web/content/${this.model}/${this.id}/${this.props.name}?download=true`,
                        `/web/image/${this.model}/${this.id}/${this.props.name}?format=svg`,
                        `/web/image/${this.model}/${this.id}/${this.props.name}`,
                    ];

                    for (const url of urlsToTry) {
                        try {
                            const response = await fetch(url, {
                                headers: { 'Accept': 'image/svg+xml,*/*' },
                            });
                            if (response.ok) {
                                const content = await response.text();
                                if (content.includes('<svg') || content.includes('<?xml')) {
                                    svgContent = content;
                                    break;
                                }
                            }
                        } catch (fetchError) {
                        }
                    }
                }
            }

            // Check if content is actually SVG
            if (!svgContent.includes('<svg')) {
                // Detect file type for better error messaging
                const isPNG = svgContent.startsWith('PNG') || svgContent.includes('PNG');
                const isJPG = svgContent.startsWith('ÿØÿà') || svgContent.includes('JFIF');

                let fileType = 'unknown format';
                if (isPNG) fileType = 'PNG image';
                else if (isJPG) fileType = 'JPEG image';

                console.error(`❌ Content is not a valid SVG (detected: ${fileType}), using fallback. Content preview:`, svgContent.substring(0, 100));

                // Create a user-friendly fallback SVG
                svgContent = `<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0" y="0" width="300" height="300" fill="#f8f9fa" stroke="#dee2e6" stroke-width="2"/>
                    <text x="150" y="130" text-anchor="middle" fill="#6c757d" font-family="Arial" font-size="14">Invalid SVG file</text>
                    <text x="150" y="150" text-anchor="middle" fill="#6c757d" font-family="Arial" font-size="12">Detected: ${fileType}</text>
                    <text x="150" y="170" text-anchor="middle" fill="#6c757d" font-family="Arial" font-size="12">Please upload an SVG file</text>
                </svg>`;
            }

            // For non-location models, just use the base SVG without avatars
            if (this.model !== "rs.location") {
                this.state.modifiedSvgSrc = `data:image/svg+xml;base64,${btoa(svgContent)}`;
            } else {
                // For location models, we'll process avatars later in the location-specific logic
                // Just store the base content for now
                this.baseSvgContent = svgContent;
            }

        } catch (error) {
            console.error(" Error loading base SVG:", error);
            // Fallback SVG
            this.state.modifiedSvgSrc = `data:image/svg+xml;base64,${btoa('<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="300" height="300" fill="lightgray"/><text x="150" y="150" text-anchor="middle" fill="red">Error Loading SVG</text></svg>')}`;
        }
    }

    addAvatarsToSvg(svgContent, seatAssignments) {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgContent, "image/svg+xml");
        const svgElement = svgDoc.documentElement;

        // Normalisierung: SVG auf feste Referenzgröße skalieren
        const originalWidth = parseFloat((svgElement.getAttribute("width") || 800).toString().replace('mm', ''));
        const originalHeight = parseFloat((svgElement.getAttribute("height") || 800).toString().replace('mm', ''));

        // Definiere eine Referenzgröße (z.B. 1000x1000) für konsistente Avatar-Größen
        const REFERENCE_SIZE = 1000;
        const scaleFactor = REFERENCE_SIZE / Math.max(originalWidth, originalHeight);

        // Berechne normalisierte Avatar-Größe basierend auf dem Skalierungsfaktor
        const baseSize = this.props.avatar_size || 20;
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

            // Don't add event listeners here - they will be added in makeAvatarsDraggable()

            group.appendChild(image);
        });

        svgElement.appendChild(group);
        const serializer = new XMLSerializer();
        const modifiedSvg = serializer.serializeToString(svgDoc);
        return modifiedSvg;
    }

    showUserCard(assignment, target) {
        this.popover.add(
            target,
            AvatarCardPopover,
            {
                id: assignment.user_id[0],
            },
            {
                position: "bottom",
            }
        );
    }

    startDrag(event, assignment, imageElement) {
        event.preventDefault();
        event.stopPropagation();

        // Prevent multiple drag operations
        if (this.state.isDragging) {
            return;
        }

        // Validate input parameters
        if (!assignment || !imageElement) {
            console.error("Invalid parameters for startDrag - assignment:", assignment, "imageElement:", imageElement);
            return;
        }

        const svg = imageElement.ownerSVGElement;
        if (!svg) {
            console.error("Cannot find SVG element for drag operation");
            return;
        }

        // Set dragging flag
        this.state.isDragging = true;

        const pt = svg.createSVGPoint();
        pt.x = event.clientX;
        pt.y = event.clientY;

        const screenCTM = svg.getScreenCTM();
        if (!screenCTM) {
            console.error("Failed to get screenCTM for the SVG element.");
            return;
        }

        const startPoint = pt.matrixTransform(screenCTM.inverse());
        const startX = startPoint.x;
        const startY = startPoint.y;
        const initialX = parseFloat(imageElement.getAttribute("x"));
        const initialY = parseFloat(imageElement.getAttribute("y"));

        const onMouseMove = (moveEvent) => {
            // Validate that we still have valid assignment and imageElement
            if (!assignment || !imageElement) {
                console.warn("Assignment or imageElement undefined during drag, stopping drag operation");
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                return;
            }

            const movePt = svg.createSVGPoint();
            movePt.x = moveEvent.clientX;
            movePt.y = moveEvent.clientY;
            const currentPoint = movePt.matrixTransform(svg.getScreenCTM().inverse());

            const dx = currentPoint.x - startX;
            const dy = currentPoint.y - startY;

            imageElement.setAttribute("x", initialX + dx);
            imageElement.setAttribute("y", initialY + dy);

            // Update resize handles if this avatar is selected
            const avatarIndex = parseInt(imageElement.dataset.index);
            if (this.state.selectedAvatarIndex === avatarIndex) {
                // Update assignment position in real-time for resize handles
                const avatarSize = parseFloat(imageElement.getAttribute("width"));
                const avatarOffset = avatarSize / 2;
                assignment.position_x = parseFloat(imageElement.getAttribute("x")) + avatarOffset;
                assignment.position_y = parseFloat(imageElement.getAttribute("y")) + avatarOffset;
                this.renderResizeHandles();
            }
        };

        const onMouseUp = async () => {
            // Validate that we still have valid assignment and imageElement
            if (!assignment || !imageElement) {
                console.warn("Assignment or imageElement undefined during mouseup, cleaning up event listeners");
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                this.state.isDragging = false;
                return;
            }

            // Update the position in the state
            // Berechne den Offset basierend auf der normalisierten Avatar-Größe
            const avatarSize = parseFloat(imageElement.getAttribute("width"));
            const avatarOffset = avatarSize / 2;

            const newX = parseFloat(imageElement.getAttribute("x")) + avatarOffset;
            const newY = parseFloat(imageElement.getAttribute("y")) + avatarOffset;
            assignment.position_x = newX;
            assignment.position_y = newY;

            // Save the updated position to the backend
            try {
                await this.orm.write("rs.location.seat.assignment", [assignment.id], {
                    position_x: newX,
                    position_y: newY,
                });

                await this.props.record.load();
            } catch (error) {
                console.error("Error saving avatar position:", error);
            }

            // Remove event listeners and reset dragging flag
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            this.state.isDragging = false;
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
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
}

export const imageClickEnlarge = {
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
    fieldDependencies: [{ name: "write_date", type: "datetime" }],
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

registry.category("fields").add("svg_view", imageClickEnlarge);