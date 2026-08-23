export namespace remote {
	
	export class Access {
	    url: string;
	    qrDataUrl: string;
	    active: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Access(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.url = source["url"];
	        this.qrDataUrl = source["qrDataUrl"];
	        this.active = source["active"];
	    }
	}

}

export namespace update {
	
	export class Info {
	    current: string;
	    latest: string;
	    available: boolean;
	    notes: string;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.current = source["current"];
	        this.latest = source["latest"];
	        this.available = source["available"];
	        this.notes = source["notes"];
	    }
	}

}

