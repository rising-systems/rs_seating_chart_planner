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
        });

        onWillStart(async () => {
            // Wait for props.record to be available
            while (!this.props.record || !this.props.record.data) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        });

        onMounted(async () => {
            this.renderSvg(this.container);
            if (!this.state.modifiedSvgSrc) {
                // No action needed here as the state is already initialized.
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

        // Use useEffect to watch for changes in seat_assignments
        useEffect(() => {
            const assignments = Array.isArray(this.props.record.data.seat_assignments)
                ? this.props.record.data.seat_assignments
                : [];
            this.state.seatAssignments = assignments;
            this.fetchSeatAssignmentsAndProcessSvg();
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
        if (!this.isReadOnly) return;

        // Find the closest avatar image element
        const avatarElement = event.target.closest('.draggable-avatar');
        if (!avatarElement) return;

        const index = avatarElement.dataset.index;
        if (index !== undefined) {
            event.preventDefault();
            event.stopPropagation();
            const assignment = this.state.seatAssignments[index];
            this.showUserCard(assignment, avatarElement);
        }
    }

    renderSvg(container) {
        if (!container) {
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
        if (this.model === "rs.location" && this.id && this.id !== "0") {
            let attempts = 0;
            const maxAttempts = 3;

            while (attempts < maxAttempts) {
                try {
                    // Fetch seat assignments and process SVG
                    const seatAssignments = await this.orm.searchRead(
                        "rs.location.seat.assignment",
                        [["location_id", "=", parseInt(this.id)]],
                        ["user_id", "position_x", "position_y"],
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

                    let svgSrc;

                    if (this.props.name) {
                        svgSrc = `/web/image/${this.model}/${this.id}/${this.props.name}?format=svg`;
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
                        console.error("Content is not a valid SVG, using default:", svgContent);
                        svgContent = `<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="300" height="300" fill="white"/></svg>`;
                    }

                    const modifiedSvg = this.addAvatarsToSvg(svgContent, this.state.seatAssignments);
                    this.state.modifiedSvgSrc = `data:image/svg+xml;base64,${btoa(modifiedSvg)}`;
                    this.renderSvg(this.container);
                    this.makeAvatarsDraggable();

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

            // Verwende die normalisierte Größe für konsistente Darstellung
            const avatarOffset = normalizedAvatarSize / 2;
            image.setAttribute("x", assignment.position_x - avatarOffset);
            image.setAttribute("y", assignment.position_y - avatarOffset);
            image.setAttribute("width", normalizedAvatarSize);
            image.setAttribute("height", normalizedAvatarSize);
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

        const svg = imageElement.ownerSVGElement;
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
            const movePt = svg.createSVGPoint();
            movePt.x = moveEvent.clientX;
            movePt.y = moveEvent.clientY;
            const currentPoint = movePt.matrixTransform(svg.getScreenCTM().inverse());

            const dx = currentPoint.x - startX;
            const dy = currentPoint.y - startY;

            imageElement.setAttribute("x", initialX + dx);
            imageElement.setAttribute("y", initialY + dy);
        };

        const onMouseUp = async () => {
            // Update the position in the state
            // Berechne den Offset basierend auf der normalisierten Avatar-Größe
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